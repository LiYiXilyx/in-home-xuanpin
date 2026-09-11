import unittest
from PIL import Image
import pyscreeze
from mouse_backend import load_template,TEMPLATES,title_matches

class ImageTest(unittest.TestCase):
    def test_actual_page_title(self):
        self.assertTrue(title_matches('Replacement Parts - Google Chrome','Replacement Parts'))
        self.assertFalse(title_matches('Temu辅助采集测试 - 影刀','Replacement Parts'))
        self.assertFalse(title_matches('cmd.exe','Replacement Parts'))
        self.assertFalse(title_matches('Chrome',''))
    def test_unicode_path_templates_match_without_cv_file_read(self):
        for name in TEMPLATES:
            with self.subTest(name=name):
                template=load_template(name)
                screen=Image.new('RGB',(template.width+80,template.height+80),(32,53,81))
                screen.paste(template,(40,40))
                matches=list(pyscreeze.locateAll(template,screen,confidence=.99))
                self.assertTrue(any(abs(m.left-40)<=1 and abs(m.top-40)<=1 for m in matches))

if __name__=='__main__':unittest.main()
