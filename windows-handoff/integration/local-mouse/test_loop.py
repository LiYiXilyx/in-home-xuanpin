import unittest
from worker import collect_loop, wait_for_human, PageUnavailable, decode_response, UserStopped, HumanNeeded

class LoopTest(unittest.TestCase):
    def run_case(self,scroll_load=False):
        state=dict(count=0,ids=['a'],receipt=0,retry=False,busy=False,y=0,more=False)
        clicks=[];scrolls=[]
        def inspect():return dict(state)
        def click(name):
            clicks.append(name)
            if name=='测试_采集':state['receipt']+=1;state['count']=len(state['ids'])
            elif name=='测试_更多':state.update(ids=['a','b'],more=False)
        def scroll():
            scrolls.append(1);state['y']+=100
            if len(scrolls)==2:
                if scroll_load:state['ids']=['a','b']
                else:state['more']=True
        def wait(predicate):
            for _ in range(100):
                s=inspect()
                if predicate(s):return s
            raise AssertionError('timeout')
        result=collect_loop(inspect,click,scroll,wait,lambda _:None,inspect(),2,lambda _:None)
        self.assertEqual(result['captures'],2)
        self.assertEqual(len(scrolls),2)
        self.assertEqual(clicks,['测试_采集']+([] if scroll_load else ['测试_更多'])+['测试_采集'])
    def test_no_recapture_on_unchanged_scroll(self):self.run_case()
    def test_capture_scroll_loaded_products(self):self.run_case(True)

    def test_resume_requires_explicit_click_and_original_task(self):
        decisions=iter(['', 'resume', 'resume'])
        states=iter([dict(version=1,bound=True,campaign='wrong',url='page'),
                     dict(version=1,bound=True,campaign='task',url='page')])
        logs=[]
        wait_for_human(lambda:next(states),lambda:next(decisions),lambda _:None,('task','page'),logs.append)
        self.assertTrue(any('暂不能继续' in x for x in logs))

    def test_human_stop(self):
        with self.assertRaisesRegex(UserStopped,'人工结束'):
            wait_for_human(lambda:None,lambda:'stop',lambda _:None,('task','page'),lambda _:None)

    def test_pause_survives_navigation_error(self):
        decisions=iter([PageUnavailable('navigation'),'', 'resume'])
        def show():
            result=next(decisions)
            if isinstance(result,Exception):raise result
            return result
        wait_for_human(lambda:dict(version=1,bound=True,campaign='task',url='page'),show,lambda _:None,('task','page'),lambda _:None)

    def test_vm_envelope(self):
        self.assertEqual(decode_response({'status':'OK','value':'{"result":{"type":"string","value":"\\"resume\\""}}'}),'resume')
        with self.assertRaises(PageUnavailable):
            decode_response({'status':'OK','value':'{"exceptionDetails":{}}'})

    def test_try_again_never_clicked(self):
        with self.assertRaises(HumanNeeded):
            collect_loop(lambda:dict(count=10,retry=True),lambda _:self.fail('must not click'),None,None,None,{'count':10},2000,lambda _:None)

    def test_2000_goal_counts_database_delta(self):
        result=collect_loop(lambda:dict(count=2281),None,None,None,None,{'count':281},2000,lambda _:None)
        self.assertEqual(result['added'],2000)

if __name__=='__main__':unittest.main()
