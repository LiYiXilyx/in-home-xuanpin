import { AppError } from '../../shared/errors.mjs';

export const REVIEW_RISK_SIGNALS=Object.freeze([
  'ITEMS_GONE','ZERO_PRODUCT_CARDS','SEARCH_NO_RESULTS','CAPTCHA','LOGIN_REQUIRED','HTTP_403','HTTP_429','ACCESS_RESTRICTED'
]);

const RISK_SIGNALS=new Set(REVIEW_RISK_SIGNALS);

export function createReviewNavigationSafety({ jobRepository,config={},now=() => new Date() }) {
  const settings=normalizeSettings(config.reviews?.navigationSafety);

  function status(jobId) {
    const job=requireReviewJob(jobRepository,jobId);
    return { enabled:settings.enabled,settings:publicSettings(settings),state:readState(job),jobStatus:job.status };
  }

  function beforeClaim(jobId) {
    const job=requireReviewJob(jobRepository,jobId);if (!settings.enabled) return status(jobId);
    const state=readState(job);assertGateClosed(state);
    if (state.productsClaimed >= settings.maxProductsPerSession) {
      const opened=openCircuit(job,state,'SESSION_PRODUCT_BUDGET_EXHAUSTED',{ productsClaimed:state.productsClaimed });
      throw gateError(opened);
    }
    return { enabled:true,settings:publicSettings(settings),state };
  }

  function recordClaim(jobId,{ queueId,goodsId }) {
    const job=requireReviewJob(jobRepository,jobId);if (!settings.enabled) return status(jobId);
    const state=readState(job);assertGateClosed(state);
    const next={ ...state,productsClaimed:state.productsClaimed+1,lastClaimedAt:iso(now()),lastQueueId:queueId,lastGoodsId:String(goodsId) };
    save(job,next);jobRepository.appendEvent(jobId,'review_navigation_product_claimed','info','Review Queue 已在会话预算内领取商品。',
      { queueId,goodsId,productsClaimed:next.productsClaimed,maxProductsPerSession:settings.maxProductsPerSession });
    return next;
  }

  function beforeNavigation(jobId,{ queueId,goodsId,method='FRESH_NAVIGATION' }={}) {
    const job=requireReviewJob(jobRepository,jobId);if (!settings.enabled) return status(jobId);
    const state=readState(job);assertGateClosed(state);
    const current=now().getTime();
    if (state.lastNavigationAt) {
      const waitUntil=new Date(state.lastNavigationAt).getTime()+settings.minimumNavigationIntervalMs;
      if (current < waitUntil) throw new AppError('Review 导航限速中，请等待后再继续。',{
        code:'REVIEW_NAVIGATION_RATE_LIMITED',retriable:true,details:{ retryAfterMs:waitUntil-current,waitUntil:new Date(waitUntil).toISOString() }
      });
    }
    if (state.navigationAttempts >= settings.maxNavigationAttemptsPerSession) {
      const opened=openCircuit(job,state,'SESSION_NAVIGATION_BUDGET_EXHAUSTED',{ navigationAttempts:state.navigationAttempts });
      throw gateError(opened);
    }
    const next={ ...state,navigationAttempts:state.navigationAttempts+1,lastNavigationAt:iso(now()),lastQueueId:queueId ?? state.lastQueueId,lastGoodsId:String(goodsId ?? state.lastGoodsId ?? ''),lastNavigationMethod:method };
    save(job,next);jobRepository.appendEvent(jobId,'review_navigation_attempt','info','Review Fresh Navigation 已计入会话预算。',
      { queueId,goodsId,method,navigationAttempts:next.navigationAttempts,maxNavigationAttemptsPerSession:settings.maxNavigationAttemptsPerSession });
    return next;
  }

  function signal(jobId,{ queueId=null,goodsId=null,code,evidence={} }={}) {
    const job=requireReviewJob(jobRepository,jobId);const normalized=String(code ?? '').toUpperCase();
    if (!RISK_SIGNALS.has(normalized)) throw new AppError('未知的 Review 导航风险信号。',{ code:'REVIEW_SAFETY_SIGNAL_INVALID',details:{ allowed:REVIEW_RISK_SIGNALS } });
    if (!settings.enabled) return status(jobId);
    const state=readState(job);const alreadyOpen=state.circuitState === 'open';const opened=openCircuit(job,state,normalized,{ queueId,goodsId,evidence });
    if (!alreadyOpen) jobRepository.appendEvent(jobId,'review_navigation_circuit_open','warn','检测到平台风险信号，Review 导航熔断已打开。',
      { queueId,goodsId,reason:normalized,cooldownUntil:opened.cooldownUntil,manualRecoveryRequired:true,evidence:sanitizeEvidence(evidence) });
    return { enabled:true,settings:publicSettings(settings),state:opened,alreadyOpen };
  }

  function recover(jobId,{ operatorConfirmed=false,health={},overrideCooldown=false,overrideReason='' }={}) {
    const job=requireReviewJob(jobRepository,jobId);if (!settings.enabled) return status(jobId);
    const state=readState(job);
    if (state.circuitState !== 'open') throw new AppError('Review 导航熔断当前没有打开。',{ code:'REVIEW_SAFETY_GATE_NOT_OPEN' });
    const cooldownRemainingMs=Math.max(0,new Date(state.cooldownUntil).getTime()-now().getTime());
    const auditedOverride=overrideCooldown === true && overrideReason === 'OPERATOR_REQUESTED_LIVE_SINGLE_PRODUCT_SMOKE';
    if (cooldownRemainingMs > 0 && !auditedOverride) throw new AppError('Review 导航仍在冷却期。',{ code:'REVIEW_SAFETY_COOLDOWN_ACTIVE',retriable:true,details:{ cooldownRemainingMs,cooldownUntil:state.cooldownUntil } });
    const validation=validateHealth(operatorConfirmed,health);
    if (!validation.passed) throw new AppError('人工恢复 Gate 未通过，Review 导航继续暂停。',{ code:'REVIEW_SAFETY_RECOVERY_NOT_VALIDATED',retriable:true,details:validation });
    if (auditedOverride) jobRepository.appendEvent(jobId,'review_navigation_cooldown_overridden','warn','运营人员明确要求立即执行单商品真实 smoke，已审计覆盖剩余冷却时间。',
      { overrideReason,cooldownRemainingMs,originalCooldownUntil:state.cooldownUntil,singleProductOnly:true });
    const recovered={ ...initialState(now),recoveryCount:state.recoveryCount+1,lastRecoveredAt:iso(now()),lastRecoveryValidation:validation };
    save(job,recovered);jobRepository.appendEvent(jobId,'review_navigation_circuit_recovered','success','冷却期结束且人工健康检查通过，Review 导航熔断已关闭。',
      { recoveryCount:recovered.recoveryCount,validation });
    return { enabled:true,settings:publicSettings(settings),state:recovered,validation,cooldownOverridden:auditedOverride };
  }

  function openCircuit(job,state,reason,details={}) {
    if (state.circuitState === 'open') return state;
    const openedAt=iso(now());const cooldownUntil=new Date(now().getTime()+settings.cooldownMs).toISOString();
    const next={ ...state,circuitState:'open',openedAt,cooldownUntil,reason,manualRecoveryRequired:true,signalCount:state.signalCount+1,lastSignal:{ code:reason,at:openedAt,...sanitizeEvidence(details) } };
    save(job,next);return next;
  }

  function save(job,state) { jobRepository.checkpointJob(job.id,{ ...(job.checkpoint ?? {}),reviewNavigationSafety:state }); }
  function readState(job) { return { ...initialState(now),...(job.checkpoint?.reviewNavigationSafety ?? {}) }; }
  function assertGateClosed(state) { if (state.circuitState === 'open') throw gateError(state); }
  return { settings,status,beforeClaim,recordClaim,beforeNavigation,signal,recover };
}

function initialState(now) { return { schemaVersion:1,circuitState:'closed',openedAt:null,cooldownUntil:null,reason:null,manualRecoveryRequired:false,signalCount:0,navigationAttempts:0,productsClaimed:0,sessionStartedAt:iso(now),lastNavigationAt:null,lastClaimedAt:null,lastQueueId:null,lastGoodsId:null,lastNavigationMethod:null,recoveryCount:0 }; }
function normalizeSettings(input={}) { return { enabled:input?.enabled === true,cooldownMs:nonNegative(input.cooldownMs,3_600_000),minimumNavigationIntervalMs:nonNegative(input.minimumNavigationIntervalMs,15_000),maxNavigationAttemptsPerSession:positive(input.maxNavigationAttemptsPerSession,15),maxProductsPerSession:positive(input.maxProductsPerSession,5) }; }
function publicSettings(settings) { return { ...settings,manualRecoveryRequired:true }; }
function positive(value,fallback) { const number=Number(value);return Number.isInteger(number) && number>0 ? number:fallback; }
function nonNegative(value,fallback) { const number=Number(value);return Number.isFinite(number) && number>=0 ? number:fallback; }
function iso(value) { return (typeof value === 'function' ? value():value).toISOString(); }
function requireReviewJob(repository,jobId) { const job=repository.getJob(String(jobId ?? ''));if (!job || job.jobType !== 'reviews') throw new AppError('找不到指定评论任务。',{ code:'JOB_NOT_FOUND' });return job; }
function gateError(state) { return new AppError('Review 导航熔断已打开，必须等待冷却并通过人工恢复 Gate。',{ code:'REVIEW_SAFETY_GATE_OPEN',retriable:true,details:{ reason:state.reason,cooldownUntil:state.cooldownUntil,manualRecoveryRequired:true } }); }
function validateHealth(operatorConfirmed,health) {
  const checks={ operatorConfirmed:operatorConfirmed === true,loggedIn:health.loggedIn === true,productCardsVisible:health.productCardsVisible === true,captchaClear:health.captcha === false,
    siteCountry:['德国','germany','de'].includes(String(health.siteCountry ?? '').trim().toLowerCase()),language:String(health.language ?? '').trim().toLowerCase().startsWith('en'),currency:String(health.currency ?? '').trim().toUpperCase()==='EUR' };
  return { passed:Object.values(checks).every(Boolean),checks,health:{ siteCountry:health.siteCountry ?? null,language:health.language ?? null,currency:health.currency ?? null } };
}
function sanitizeEvidence(value) { return JSON.parse(JSON.stringify(value ?? {},(_key,item) => typeof item === 'string' ? item.slice(0,500):item)); }
