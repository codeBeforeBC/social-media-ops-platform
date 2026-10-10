import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync} from 'node:fs';
const credentials=()=>JSON.parse(readFileSync((process.env.STATE_DIR??'.local/state')+'/instance.json','utf8'));
test('首次设置、三导航、账号表单、设置保存、键盘抽屉和退出',async({page})=>{
  const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'创建你的工作台'})).toBeVisible();
  await page.getByLabel('实例初始化凭据').fill(credentials().setup_token);await page.getByLabel('工作区名称').fill('浏览器测试工作区');await page.getByLabel('你的名字').fill('测试运营');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');
  await page.getByRole('button',{name:'创建并进入'}).click();await expect(page.getByRole('heading',{name:'测试运营，欢迎回来'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'主导航'}).getByRole('link')).toHaveCount(3);
  for(const label of ['选题策划','数据复盘']){await page.getByRole('link',{name:label,exact:true}).click();await expect(page.getByRole('heading',{name:label,exact:true})).toBeVisible();}
  await page.getByRole('link',{name:'工作区设置'}).click();await page.getByRole('button',{name:'运营账号',exact:true}).click();await expect(page.getByRole('heading',{name:'还没有运营账号'})).toBeVisible();
  await page.getByRole('button',{name:'添加账号',exact:true}).click();await page.getByLabel('平台内部账号 ID').fill('browser-platform-id');await page.getByLabel('名称',{exact:false}).fill('真实标识测试账号');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('cell',{name:'真实标识测试账号'})).toBeVisible();
  await page.getByRole('button',{name:'查看 / 编辑'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'查看 / 编辑'})).toBeFocused();
  await page.getByRole('button',{name:'工作区',exact:true}).click();await page.getByLabel('名称',{exact:false}).fill('已修改工作区');await page.getByRole('button',{name:'保存设置'}).click();await expect(page.getByRole('status')).toContainText('已保存');
  await page.getByRole('button',{name:'后台任务',exact:true}).click();await expect(page.getByRole('heading',{name:'暂无后台任务'})).toBeVisible();
  await page.getByRole('button',{name:'通知',exact:true}).click();await expect(page.getByRole('heading',{name:'暂无通知'})).toBeVisible();await page.keyboard.press('Escape');
  await page.getByRole('link',{name:'工作台',exact:false}).first().click();await expect(page.getByRole('heading',{name:'测试运营，欢迎回来'})).toBeVisible();
  mkdirSync('docs/evidence/s11/screenshots/foundation',{recursive:true});
  for(const width of [1440,1280,390]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`docs/evidence/s11/screenshots/foundation/home-${width}.png`,fullPage:true});}
  await page.setViewportSize({width:1280,height:1000});await page.keyboard.press('Tab'); // 焦点流程不依赖鼠标，抽屉支持Escape。
  await page.getByRole('button',{name:'测试运营',exact:true}).click();await page.getByRole('button',{name:'退出登录'}).click();await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();expect(failures).toEqual([]);
});
test('请求失败显示可重试错误，加载状态和登录过期可见',async({page})=>{
  await page.goto('/');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('heading',{name:'测试运营，欢迎回来'})).toBeVisible();
  await page.route('**/api/v1/settings',async route=>{await new Promise(r=>setTimeout(r,500));await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'测试服务不可用',request_id:'browser-error'}})});});
  await page.getByRole('link',{name:'工作区设置'}).click();await expect(page.getByRole('status')).toContainText('正在加载');await expect(page.getByRole('alert')).toContainText('测试服务不可用');await page.unroute('**/api/v1/settings');await page.getByRole('button',{name:'重试'}).click();await expect(page.getByLabel('名称',{exact:false})).toHaveValue('已修改工作区');
  await page.route('**/api/v1/notifications',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'SESSION_EXPIRED',message:'登录已过期'}})}));await page.getByRole('button',{name:'通知',exact:true}).click();await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('登录已过期');
});

test('来源连接保存、独立待验证状态、启用和同源运行记录',async({page})=>{
 await page.goto('/');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('link',{name:'选题策划'}).click();await expect(page.getByRole('heading',{name:'还没有来源连接'})).toBeVisible();
 await page.getByRole('button',{name:'添加来源',exact:true}).click();await page.getByLabel('来源名称').fill('浏览器采集连接');await page.getByRole('button',{name:'保存连接'}).click();const row=page.getByRole('row').filter({hasText:'浏览器采集连接'});await expect(row).toContainText('待验证');await expect(row.getByRole('button',{name:'立即采集'})).toBeDisabled();
 await row.getByRole('button',{name:'启用定时'}).click();await expect(row.getByRole('button',{name:'立即采集'})).toBeEnabled();await row.getByRole('button',{name:'立即采集'}).click();await expect(page.getByRole('status')).toContainText('已排队');await row.getByRole('button',{name:'立即采集'}).click();await expect(page.getByRole('status')).toContainText('现有采集任务');
 await row.getByRole('button',{name:'运行记录'}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('等待执行');await expect(dialog.getByText('等待处理',{exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'添加来源',exact:true}).click();await page.getByLabel('来源名称').fill('参考账号配置');await page.getByLabel('来源类型').selectOption('xhs_quality_note');await page.getByLabel('浏览器档案 ID（小红书）').fill('controlled-profile');await page.getByLabel('参考账号 ID（仅优质笔记，最多2个，逗号分隔）').fill('abcdefabcdefabcdefabcdef');await page.getByRole('button',{name:'保存连接'}).click();await expect(page.getByRole('row').filter({hasText:'参考账号配置'})).toContainText('待验证');
 mkdirSync('docs/evidence/s11/screenshots',{recursive:true});await page.screenshot({path:'docs/evidence/s11/screenshots/collection-runtime.png',fullPage:true});
});


test('来源证据详情保留原始观察、采集时间和缺失发布时间',async({page})=>{
 execFileSync('pnpm',['exec','tsx','tools/s3-browser-seed.ts'],{stdio:'pipe',env:process.env});
 await page.goto('/');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('link',{name:'选题策划'}).click();await expect(page.getByRole('heading',{name:'明确合成的浏览器证据线索'})).toBeVisible();await page.getByRole('button',{name:'查看来源与观察记录'}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('未提供，不以采集时间代替');await expect(dialog.getByRole('heading',{name:'观察记录'})).toBeVisible();await expect(dialog).toContainText('heat：123');await expect(dialog.getByRole('link',{name:'打开原始来源'})).toHaveAttribute('href','https://s.weibo.com/weibo?q=controlled');await page.keyboard.press('Escape');
 await page.getByPlaceholder('标题、摘要或采集关键词').fill('无匹配测试');await page.getByRole('button',{name:'筛选',exact:true}).click();await expect(page.getByRole('heading',{name:'暂无匹配线索'})).toBeVisible();
});

test('候选理由/评分/证据、默认本人采纳、拒绝留因与显式变体',async({page})=>{
 execFileSync('pnpm',['exec','tsx','tools/s3-topics-browser-seed.ts'],{stdio:'pipe',env:process.env});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('link',{name:'选题策划'}).click();
 const adopt=page.locator('.topic-card').filter({hasText:'合成候选：采纳操作'});await expect(adopt).toContainText('80.00/100');await adopt.getByRole('button',{name:'查看理由与采纳'}).click();const dialog=page.getByRole('dialog',{name:'选题理由与证据'});await expect(dialog).toContainText('受众需求：4/5');await expect(dialog).toContainText('明确合成的浏览器证据线索');await expect(dialog).toContainText('来源原文（真实性待核验）');await expect(dialog).toContainText('缺受众反馈');await dialog.getByRole('button',{name:'采纳选题',exact:true}).click();await expect(dialog).toContainText('负责人');await dialog.getByRole('button',{name:'确认采纳',exact:true}).click();await expect(dialog).toContainText('已采纳');await expect(dialog.getByRole('button',{name:'采纳选题',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
 const reject=page.locator('.topic-card').filter({hasText:'合成候选：拒绝操作'});await reject.getByRole('button',{name:'查看理由与采纳'}).click();await dialog.getByRole('button',{name:'拒绝并留因'}).click();await dialog.getByLabel('拒绝原因',{exact:true}).fill('本周产能不足');await dialog.getByRole('button',{name:'保存拒绝原因'}).click();await expect(dialog).toContainText('本周产能不足');await expect(dialog).toContainText('已拒绝');await dialog.getByRole('button',{name:'明确创建变体'}).click();await dialog.getByLabel('变体目标',{exact:true}).fill('减少页数的新角度');await dialog.getByRole('button',{name:'创建变体',exact:true}).click();await expect(dialog).toContainText('减少页数的新角度');await expect(dialog.getByRole('button',{name:'查看父题'})).toBeVisible();await page.keyboard.press('Escape');
 await page.getByRole('combobox',{name:'选题状态',exact:true}).selectOption('accepted');await expect(page.locator('.topic-card')).toHaveCount(1);await expect(page.locator('.topic-card')).toContainText('合成候选：采纳操作');await page.getByRole('combobox',{name:'选题状态',exact:true}).selectOption('');
 await page.setViewportSize({width:390,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);mkdirSync('docs/evidence/s11/screenshots',{recursive:true});await page.screenshot({path:'docs/evidence/s11/screenshots/topic-candidates-mobile.png',fullPage:true});expect(errors).toEqual([]);
});



test('T26 独立笔记登记与更正、旧深链回退、三导航窄屏无溢出',async({page})=>{
 await page.goto('/');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');await page.getByRole('button',{name:'登录',exact:true}).click();
 for(const path of ['assets','contents','calendar','campaigns','contents/old-revision']){await page.evaluate(p=>location.hash=p,path);await expect(page.getByRole('status')).toContainText('此模块已移除');await expect(page).toHaveURL(/#home$/);}
 await page.getByRole('link',{name:'数据复盘',exact:true}).click();await page.getByRole('button',{name:'登记已发布笔记',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('平台笔记 ID').fill('s11-browser-note');await dialog.getByLabel('原帖 HTTPS 链接').fill('https://www.xiaohongshu.com/explore/s11-browser-note');await dialog.getByLabel('笔记标题').fill('明确合成：独立笔记');await dialog.getByLabel('实际发布时间（本机时区）').fill('2026-10-01T12:00');await dialog.getByRole('button',{name:'保存笔记登记'}).click();await expect(page.getByRole('cell',{name:/明确合成：独立笔记/})).toBeVisible();
 await page.getByRole('button',{name:'更正登记'}).click();await expect(dialog.getByLabel('平台笔记 ID')).toHaveCount(0);await dialog.getByLabel('笔记标题').fill('明确合成：更正标题');await dialog.getByLabel('更正原因').fill('人工核对标题');await dialog.getByRole('button',{name:'保存笔记登记'}).click();await expect(page.getByRole('cell',{name:/明确合成：更正标题/})).toBeVisible();
 for(const width of [1440,1280,390]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`docs/evidence/s11/screenshots/publications-${width}.png`,fullPage:true});}
});
