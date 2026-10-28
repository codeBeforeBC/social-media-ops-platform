/** Parse only an explicit public profile identity; never follow a supplied URL. */
export function xhsAccountIdentity(value:unknown){
  if(typeof value!=='string'||value.length>2000)return null;
  const raw=value.trim();
  const id=/^[a-fA-F0-9]{24}$/.test(raw)?raw:raw.match(/^https:\/\/www\.xiaohongshu\.com\/user\/profile\/([a-fA-F0-9]{24})\/?(?:[?#][^\s]*)?$/)?.[1];
  if(!id)return null;
  const normalized=id.toLowerCase();
  return {id:normalized,profile_url:`https://www.xiaohongshu.com/user/profile/${normalized}`};
}
