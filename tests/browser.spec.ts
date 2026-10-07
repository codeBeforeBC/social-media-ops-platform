import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
const credentials=()=>JSON.parse(readFileSync((process.env.STATE_DIR??'.local/state')+'/instance.json','utf8'));
test('首次设置、六导航、账号表单、设置保存、键盘抽屉和退出',async({page})=>{
  const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'创建你的工作台'})).toBeVisible();
  await page.getByLabel('实例初始化凭据').fill(credentials().setup_token);await page.getByLabel('工作区名称').fill('浏览器测试工作区');await page.getByLabel('你的名字').fill('测试运营');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');
  await page.getByRole('button',{name:'创建并进入'}).click();await expect(page.getByRole('heading',{name:'测试运营，欢迎回来'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'主导航'}).getByRole('link')).toHaveCount(6);
  for(const label of ['选题策划','内容工作间','排期日历','数据复盘','IP 资产库']){await page.getByRole('link',{name:label,exact:false}).click();await expect(page.getByRole('heading',{name:'这个模块正在准备中'})).toBeVisible();}
  await page.getByRole('link',{name:'工作区设置'}).click();await page.getByRole('button',{name:'运营账号',exact:true}).click();await expect(page.getByRole('heading',{name:'还没有运营账号'})).toBeVisible();
  await page.getByRole('button',{name:'添加账号',exact:true}).click();await page.getByLabel('平台内部账号 ID').fill('browser-platform-id');await page.getByLabel('名称',{exact:false}).fill('真实标识测试账号');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('cell',{name:'真实标识测试账号'})).toBeVisible();
  await page.getByRole('button',{name:'查看 / 编辑'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'查看 / 编辑'})).toBeFocused();
  await page.getByRole('button',{name:'工作区',exact:true}).click();await page.getByLabel('名称',{exact:false}).fill('已修改工作区');await page.getByRole('button',{name:'保存设置'}).click();await expect(page.getByRole('status')).toContainText('已保存');
  await page.getByRole('button',{name:'后台任务',exact:true}).click();await expect(page.getByRole('heading',{name:'暂无后台任务'})).toBeVisible();
  await page.getByRole('button',{name:'通知',exact:true}).click();await expect(page.getByRole('heading',{name:'暂无通知'})).toBeVisible();await page.keyboard.press('Escape');
  await page.getByRole('link',{name:'工作台',exact:false}).first().click();
  mkdirSync('docs/evidence/s1/screenshots',{recursive:true});
  for(const width of [1440,1280,390]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`docs/evidence/s1/screenshots/home-${width}.png`,fullPage:true});}
  await page.setViewportSize({width:1280,height:1000});await page.keyboard.press('Tab'); // 焦点流程不依赖鼠标，抽屉支持Escape。
  await page.getByRole('button',{name:'测试运营',exact:true}).click();await page.getByRole('button',{name:'退出登录'}).click();await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();expect(failures).toEqual([]);
});
test('请求失败显示可重试错误，加载状态和登录过期可见',async({page})=>{
  await page.goto('/');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('heading',{name:'测试运营，欢迎回来'})).toBeVisible();
  await page.route('**/api/v1/settings',async route=>{await new Promise(r=>setTimeout(r,500));await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'测试服务不可用',request_id:'browser-error'}})});});
  await page.getByRole('link',{name:'工作区设置'}).click();await expect(page.getByRole('status')).toContainText('正在加载');await expect(page.getByRole('alert')).toContainText('测试服务不可用');await page.unroute('**/api/v1/settings');await page.getByRole('button',{name:'重试'}).click();await expect(page.getByLabel('名称',{exact:false})).toHaveValue('已修改工作区');
  await page.route('**/api/v1/notifications',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'SESSION_EXPIRED',message:'登录已过期'}})}));await page.getByRole('button',{name:'通知',exact:true}).click();await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('登录已过期');
});
