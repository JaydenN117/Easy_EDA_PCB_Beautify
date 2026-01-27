import os
from bs4 import BeautifulSoup
import re

def clean_html(file_path):
    print(f"Processing {file_path}...")
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            html_content = f.read()

        soup = BeautifulSoup(html_content, 'lxml')

        # 1. 提取核心内容
        main_content = soup.find('main', class_='main')
        if not main_content:
            main_content = soup.find('div', class_='vp-doc')
        
        if not main_content:
            # 尝试寻找 content 容器
            main_content = soup.find('div', class_='content-container')
        
        if not main_content:
            print(f"Warning: Could not find main content in {file_path}")
            return

        # 2. 创建极简 HTML
        simple_html = BeautifulSoup('<!DOCTYPE html><html><head><meta charset="utf-8"><title></title><style>body{font-family:sans-serif;line-height:1.6;padding:20px;max-width:1000px;margin:0 auto;color:#333;}table{border-collapse:collapse;width:100%;margin:20px 0;}th,td{border:1px solid #ddd;padding:8px;text-align:left;}th{background-color:#f4f4f4;}a{color:#007bff;text-decoration:none;}a:hover{text-decoration:underline;}pre,code{background:#f8f8f8;padding:2px 5px;border-radius:3px;font-family:monospace;}pre{padding:10px;overflow:auto;border-left:4px solid #007bff;}blockquote{margin:10px 0;padding-left:15px;border-left:4px solid #eee;color:#666;}img{max-width:100%;height:auto;}</style></head><body></body></html>', 'lxml')
        
        title_tag = soup.find('title')
        if title_tag:
            simple_html.title.string = title_tag.string
        else:
            simple_html.title.string = os.path.basename(file_path)
            
        simple_html.body.append(main_content)

        # 3. 清理
        for anchor in simple_html.find_all('a', class_='header-anchor'):
            anchor.decompose()
            
        for tag in simple_html.find_all(True):
            # 删除 data-v-*
            attrs = dict(tag.attrs)
            for attr in attrs:
                if attr.startswith('data-v-'):
                    del tag.attrs[attr]
            # 删除 inline-style (除非是图片或者表格)
            if tag.name not in ['img', 'table', 'td', 'th'] and 'style' in tag.attrs:
                del tag.attrs['style']

        for script in simple_html.find_all('script'):
            script.decompose()
            
        # 4. 保存
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(simple_html.prettify())
            
    except Exception as e:
        print(f"Error processing {file_path}: {e}")

def process_directory(directory):
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.html'):
                clean_html(os.path.join(root, file))

if __name__ == "__main__":
    target_dir = os.path.abspath("EDA_EX_DOC")
    if os.path.exists(target_dir):
        process_directory(target_dir)
        print("All documents in EDA_EX_DOC have been cleaned.")
    else:
        print(f"Error: Directory {target_dir} does not exist.")
