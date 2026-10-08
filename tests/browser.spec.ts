import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
const credentials=()=>JSON.parse(readFileSync((process.env.STATE_DIR??'.local/state')+'/instance.json','utf8'));
test('首次设置、六导航、账号表单、设置保存、键盘抽屉和退出',async({page})=>{
  const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'创建你的工作台'})).toBeVisible();
  await page.getByLabel('实例初始化凭据').fill(credentials().setup_token);await page.getByLabel('工作区名称').fill('浏览器测试工作区');await page.getByLabel('你的名字').fill('测试运营');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');
  await page.getByRole('button',{name:'创建并进入'}).click();await expect(page.getByRole('heading',{name:'测试运营，欢迎回来'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'主导航'}).getByRole('link')).toHaveCount(6);
  for(const label of ['选题策划','内容工作间','排期日历','数据复盘','IP 资产库']){await page.getByRole('link',{name:label,exact:false}).click();await expect(page.getByRole('heading',{name:label==='IP 资产库'?'IP 资产库':'这个模块正在准备中',exact:true})).toBeVisible();}
  await page.getByRole('link',{name:'工作区设置'}).click();await page.getByRole('button',{name:'运营账号',exact:true}).click();await expect(page.getByRole('heading',{name:'还没有运营账号'})).toBeVisible();
  await page.getByRole('button',{name:'添加账号',exact:true}).click();await page.getByLabel('平台内部账号 ID').fill('browser-platform-id');await page.getByLabel('名称',{exact:false}).fill('真实标识测试账号');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('cell',{name:'真实标识测试账号'})).toBeVisible();
  await page.getByRole('button',{name:'查看 / 编辑'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'查看 / 编辑'})).toBeFocused();
  await page.getByRole('button',{name:'工作区',exact:true}).click();await page.getByLabel('名称',{exact:false}).fill('已修改工作区');await page.getByRole('button',{name:'保存设置'}).click();await expect(page.getByRole('status')).toContainText('已保存');
  await page.getByRole('button',{name:'后台任务',exact:true}).click();await expect(page.getByRole('heading',{name:'暂无后台任务'})).toBeVisible();
  await page.getByRole('button',{name:'通知',exact:true}).click();await expect(page.getByRole('heading',{name:'暂无通知'})).toBeVisible();await page.keyboard.press('Escape');
  await page.getByRole('link',{name:'工作台',exact:false}).first().click();
  mkdirSync('docs/evidence/s2/screenshots/foundation',{recursive:true});
  for(const width of [1440,1280,390]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`docs/evidence/s2/screenshots/foundation/home-${width}.png`,fullPage:true});}
  await page.setViewportSize({width:1280,height:1000});await page.keyboard.press('Tab'); // 焦点流程不依赖鼠标，抽屉支持Escape。
  await page.getByRole('button',{name:'测试运营',exact:true}).click();await page.getByRole('button',{name:'退出登录'}).click();await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();expect(failures).toEqual([]);
});
test('请求失败显示可重试错误，加载状态和登录过期可见',async({page})=>{
  await page.goto('/');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('heading',{name:'测试运营，欢迎回来'})).toBeVisible();
  await page.route('**/api/v1/settings',async route=>{await new Promise(r=>setTimeout(r,500));await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'测试服务不可用',request_id:'browser-error'}})});});
  await page.getByRole('link',{name:'工作区设置'}).click();await expect(page.getByRole('status')).toContainText('正在加载');await expect(page.getByRole('alert')).toContainText('测试服务不可用');await page.unroute('**/api/v1/settings');await page.getByRole('button',{name:'重试'}).click();await expect(page.getByLabel('名称',{exact:false})).toHaveValue('已修改工作区');
  await page.route('**/api/v1/notifications',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'SESSION_EXPIRED',message:'登录已过期'}})}));await page.getByRole('button',{name:'通知',exact:true}).click();await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();await expect(page.getByRole('alert')).toContainText('登录已过期');
});

test('PNG资产上传、检索、透明预览、确认/停用及窄屏详情',async({page})=>{
 const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));
 await page.goto('/');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('link',{name:'IP 资产库'}).click();
 await page.getByText('上传素材 / 新建文件夹',{exact:true}).click();await page.getByLabel('文件（单个最大 2 GiB，最多同时上传两个）').setInputFiles({name:'浏览器透明素材.png',mimeType:'image/png',buffer:readFileSync('tests/fixtures/transparent.png')});await page.getByLabel('素材来源',{exact:false}).fill('合成测试来源，无生产使用授权');await page.getByRole('button',{name:'开始上传 / 续传'}).click();await expect(page.getByRole('heading',{name:'浏览器透明素材.png',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'收藏',exact:true}).click();await page.getByLabel('只看收藏').check();await expect(page.getByRole('heading',{name:'浏览器透明素材.png',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'PNG 素材 浏览器透明素材.png'}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await expect(async()=>{await dialog.getByRole('button',{name:'刷新处理状态'}).click();await expect(dialog.getByRole('img',{name:'浏览器透明素材.png'})).toBeVisible();}).toPass({timeout:20000});
 expect(await dialog.getByRole('img',{name:'浏览器透明素材.png'}).evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(0);
 await dialog.getByLabel('确认允许使用范围').fill('仅验收测试');await dialog.getByLabel('已核对的授权依据').fill('透明通道及测试范围确认');await dialog.getByRole('button',{name:'确认可用',exact:true}).click();await expect(dialog.getByText('PNG 素材 · 可用 · 预览就绪',{exact:true})).toBeVisible();
 await dialog.getByLabel('停用理由').fill('验收停用');await dialog.getByRole('button',{name:'停用素材',exact:true}).click();await expect(dialog.getByText('PNG 素材 · 已停用 · 预览就绪',{exact:true})).toBeVisible();
 mkdirSync('docs/evidence/s2/screenshots',{recursive:true});for(const width of [1440,1280,390]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await dialog.evaluate(el=>el.scrollTop=0);await page.screenshot({path:`docs/evidence/s2/screenshots/assets-${width}.png`,fullPage:false});}
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);expect(failures).toEqual([]);
});

test('规范PDF上传、规则录入、页码追溯与人工激活',async({page})=>{
 await page.goto('/');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('link',{name:'IP 资产库'}).click();await page.getByRole('button',{name:'品牌规范',exact:true}).click();
 await page.getByLabel('上传规范 PDF').setInputFiles({name:'规范验收.pdf',mimeType:'application/pdf',buffer:readFileSync('tests/fixtures/guideline.pdf')});await page.getByRole('button',{name:'上传 / 续传规范'}).click();
 await expect(async()=>{await page.getByRole('button',{name:'刷新',exact:true}).last().click();await expect(page.locator('p').filter({hasText:/^规范验收.pdf · 1 页$/})).toBeVisible();}).toPass({timeout:20000});
 await page.getByRole('button',{name:'阅读 规范验收.pdf',exact:true}).click();await expect(page.getByRole('img',{name:'规范第 1 页'})).toBeVisible();await page.getByLabel('检索规范文本').fill('YOYO');await page.keyboard.press('Escape');await page.getByText('建立规范版本',{exact:true}).click();await page.getByLabel('规范版本名称').fill('浏览器规则验收');await page.getByLabel('规范原件').selectOption({label:'规范验收.pdf · 1 页'});await page.getByLabel('规则原文').fill('仅为验收测试规则，无正式品牌授权');await page.getByLabel('PDF 页序').fill('1');await page.getByRole('button',{name:'保存草稿规范'}).click();await expect(page.getByRole('button',{name:'浏览器规则验收'})).toBeVisible();
 await page.getByRole('button',{name:'浏览器规则验收'}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByText('第 1 页 · color')).toBeVisible();await dialog.getByLabel('手册核对与激活依据').fill('合成PDF页序核对演练');await dialog.getByRole('button',{name:'确认激活此规范'}).click();await expect(dialog).toHaveCount(0);await expect(page.getByText('已激活',{exact:true})).toBeVisible();
});

test('素材选择器绑定具体版本，双向来源关联可见且停用版本禁选',async({page})=>{
 await page.goto('/');await page.getByLabel('邮箱').fill('browser@example.test');await page.getByLabel('密码',{exact:false}).fill('Browser-test-password-987');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('link',{name:'IP 资产库'}).click();
 await page.getByText('上传素材 / 新建文件夹',{exact:true}).click();
 for(const name of ['关联来源.png','关联衍生.png']){await page.getByLabel('文件（单个最大 2 GiB，最多同时上传两个）').setInputFiles({name,mimeType:'image/png',buffer:readFileSync('tests/fixtures/transparent.png')});await page.getByLabel('素材来源',{exact:false}).fill('合成关联测试');await page.getByRole('button',{name:'开始上传 / 续传'}).click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();}
 await page.getByRole('button',{name:'PNG 素材 关联来源.png'}).click();await page.getByRole('button',{name:'选择关联素材',exact:true}).click();const picker=page.getByRole('dialog',{name:'选择关联素材',exact:true});await expect(picker).toBeVisible();await expect(picker.locator('article').filter({hasText:'浏览器透明素材.png'}).getByRole('button',{name:'选择此版本'})).toBeDisabled();await picker.locator('article').filter({hasText:'关联衍生.png'}).getByRole('button',{name:'选择此版本'}).click();await page.getByRole('button',{name:'保存关联'}).click();await expect(page.getByText('source_of · 关联来源.png 版本 1 → 关联衍生.png 版本 1',{exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'PNG 素材 关联衍生.png'}).click();await expect(page.getByText('source_of · 关联来源.png 版本 1 → 关联衍生.png 版本 1',{exact:true})).toBeVisible();
});
