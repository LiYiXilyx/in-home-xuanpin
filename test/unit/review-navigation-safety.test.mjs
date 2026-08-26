import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReviewNavigationSafety } from '../../src/modules/reviews/review-navigation-safety.mjs';

function fixture({ cooldownMs=60_000,maxNavigationAttemptsPerSession=2,maxProductsPerSession=1 }={}) {
  let current=new Date('2026-08-26T00:00:00.000Z');
  let job={ id:'job-1',jobType:'reviews',status:'pending',checkpoint:{} };const events=[];
  const repository={
    getJob:id => id === job.id ? structuredClone(job):null,
    checkpointJob(_id,checkpoint) { job={ ...job,checkpoint:structuredClone(checkpoint) };return structuredClone(job); },
    appendEvent(_id,eventType,level,message,payload) { events.push({ eventType,level,message,payload }); }
  };
  const safety=createReviewNavigationSafety({ jobRepository:repository,config:{ reviews:{ navigationSafety:{ enabled:true,cooldownMs,
    minimumNavigationIntervalMs:0,maxNavigationAttemptsPerSession,maxProductsPerSession } } },now:() => current });
  return { safety,events,getJob:() => job,advance:ms => { current=new Date(current.getTime()+ms); } };
}

test('risk signal opens a persistent circuit and requires cooldown plus healthy operator recovery',() => {
  const f=fixture();
  const opened=f.safety.signal('job-1',{ queueId:'queue-1',goodsId:'123',code:'ITEMS_GONE',evidence:{ text:'Oops! The items are gone.' } });
  assert.equal(opened.state.circuitState,'open');assert.equal(opened.state.reason,'ITEMS_GONE');
  assert.throws(() => f.safety.beforeClaim('job-1'),error => error.code === 'REVIEW_SAFETY_GATE_OPEN');
  assert.throws(() => f.safety.recover('job-1',{ operatorConfirmed:true,health:{} }),error => error.code === 'REVIEW_SAFETY_COOLDOWN_ACTIVE');
  f.advance(60_000);
  assert.throws(() => f.safety.recover('job-1',{ operatorConfirmed:true,health:{ loggedIn:true,productCardsVisible:false,captcha:false,siteCountry:'德国',language:'en',currency:'EUR' } }),
    error => error.code === 'REVIEW_SAFETY_RECOVERY_NOT_VALIDATED');
  const recovered=f.safety.recover('job-1',{ operatorConfirmed:true,health:{ loggedIn:true,productCardsVisible:true,captcha:false,siteCountry:'德国',language:'en',currency:'EUR' } });
  assert.equal(recovered.state.circuitState,'closed');assert.equal(recovered.state.recoveryCount,1);
  assert.ok(f.events.some(event => event.eventType === 'review_navigation_circuit_recovered'));
});

test('session product and navigation budgets open the safety gate before more work is accepted',() => {
  const productFixture=fixture({ cooldownMs:0,maxProductsPerSession:1 });
  productFixture.safety.beforeClaim('job-1');productFixture.safety.recordClaim('job-1',{ queueId:'q1',goodsId:'1' });
  assert.throws(() => productFixture.safety.beforeClaim('job-1'),error => error.code === 'REVIEW_SAFETY_GATE_OPEN' && error.details.reason === 'SESSION_PRODUCT_BUDGET_EXHAUSTED');

  const navigationFixture=fixture({ cooldownMs:0,maxNavigationAttemptsPerSession:2,maxProductsPerSession:5 });
  navigationFixture.safety.beforeNavigation('job-1',{ queueId:'q1',goodsId:'1' });
  navigationFixture.safety.beforeNavigation('job-1',{ queueId:'q1',goodsId:'1' });
  assert.throws(() => navigationFixture.safety.beforeNavigation('job-1',{ queueId:'q1',goodsId:'1' }),error => error.code === 'REVIEW_SAFETY_GATE_OPEN' && error.details.reason === 'SESSION_NAVIGATION_BUDGET_EXHAUSTED');
});

test('cooldown override is explicit, health-gated, single-purpose and audited',() => {
  const f=fixture();f.safety.signal('job-1',{ code:'ITEMS_GONE' });
  const health={ loggedIn:true,productCardsVisible:true,captcha:false,siteCountry:'德国',language:'en',currency:'EUR' };
  assert.throws(() => f.safety.recover('job-1',{ operatorConfirmed:true,health,overrideCooldown:true,overrideReason:'anything-else' }),
    error => error.code === 'REVIEW_SAFETY_COOLDOWN_ACTIVE');
  const recovered=f.safety.recover('job-1',{ operatorConfirmed:true,health,overrideCooldown:true,overrideReason:'OPERATOR_REQUESTED_LIVE_SINGLE_PRODUCT_SMOKE' });
  assert.equal(recovered.cooldownOverridden,true);assert.equal(recovered.state.circuitState,'closed');
  assert.ok(f.events.some(event => event.eventType === 'review_navigation_cooldown_overridden' && event.payload.singleProductOnly === true));
});

test('business extension reports only strong review safety pages and never loops Try again',() => {
  const content=fs.readFileSync(new URL('../../browser-extension/content-script.js',import.meta.url),'utf8');
  const background=fs.readFileSync(new URL('../../browser-extension/background.js',import.meta.url),'utf8');
  assert.match(content,/ITEMS_GONE/);assert.match(content,/CAPTCHA/);assert.match(content,/LOGIN_REQUIRED/);
  assert.match(content,/safetySignalReported/);assert.doesNotMatch(content,/sessionStorage|localStorage/);assert.doesNotMatch(content,/\.click\([^)]*Try again/i);
  assert.match(background,/REPORT_REVIEW_SAFETY/);assert.match(background,/review-queue\/current/);
});
