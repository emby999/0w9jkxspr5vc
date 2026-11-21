/*********************************
百度贴吧自动签到 - Shadowrocket 版
作者: emby999
仓库: https://github.com/emby999/shadowrocket-scripts

CK 二选一:
1) 你抓到的 CK 是文本: 把整串 Cookie 粘到下面 CK = "" 的引号里, 例如
   const CK = "BDUSS=xxxx; STOKEN=xxxx; BAIDUID=xxxx";
   只填 BDUSS 也能签 (签到接口只要 BDUSS), 但获取关注列表更稳的是带上 tieba.baidu.com 域的 STOKEN。
2) 你是用抓 CK 的脚本存的: 什么都不用填, 脚本自动读 $persistentStore 里的 CookieTB
   (和原脚本同一个 key, 抓过就能直接用)。

配置 (加到 Shadowrocket 配置里):
[Script]
百度贴吧签到 = type=cron,engine=jsc,script-path=https://raw.githubusercontent.com/emby999/shadowrocket-scripts/main/TieBaSignIn.js,cronexpr="5 8 * * *",timeout=300,enable=true
# 可选, 还想自动抓 CK 时再加这一行, 并把 tieba.baidu.com 加进 [MITM] hostname:
# 百度贴吧抓CK = type=http-request,engine=jsc,script-path=https://raw.githubusercontent.com/emby999/shadowrocket-scripts/main/TieBaSignIn.js,pattern=^https:\/\/tieba\.baidu\.com\/

签到方式: 串行, 每个吧间隔 1.5 秒, 慢一点但不容易触发风控。关注的吧很多时把 timeout 调大。
*********************************/

const CK = ""; // <- 抓到的 CK 文本粘这里; 用抓包存的就留空
const ckKey = "CookieTB";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

if (typeof $request !== "undefined") {
  // ---- 抓 CK 模式 ----
  const h = $request.headers || {};
  const cookie = h["Cookie"] || h["cookie"] || "";
  if (cookie.indexOf("BDUSS=") !== -1) {
    $persistentStore.write(cookie, ckKey);
    console.log("✅ 百度贴吧 Cookie 已保存");
  } else {
    console.log("❌ 这个请求里没有 BDUSS, 没保存");
  }
  $done();
} else {
  // ---- 签到模式 ----
  mainSign();
}

function httpGet(url, cookie) {
  return new Promise((resolve, reject) => {
    $httpClient.get(
      {
        url: url,
        headers: {
          "Content-Type": "application/octet-stream",
          Referer: "https://tieba.baidu.com/index/tbwise/forum",
          Cookie: cookie,
          "User-Agent": UA,
        },
      },
      (err, resp, data) => (err ? reject(err) : resolve(data))
    );
  });
}

function httpPostSign(cookie, tbs, forumName) {
  return new Promise((resolve) => {
    $httpClient.post(
      {
        url: "https://tieba.baidu.com/sign/add",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
          "User-Agent": UA,
        },
        body:
          "tbs=" + encodeURIComponent(tbs) +
          "&kw=" + encodeURIComponent(forumName) +
          "&ie=utf-8",
      },
      (err, resp, data) => {
        if (err) return resolve({ ok: false, msg: "接口错误" });
        try {
          const r = JSON.parse(data);
          if (r.no === 0) resolve({ ok: true, msg: "签到成功" });
          else resolve({ ok: false, msg: r.error || ("no=" + r.no) });
        } catch (e) {
          resolve({ ok: false, msg: "返回解析失败" });
        }
      }
    );
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mainSign() {
  const cookie = CK || $persistentStore.read(ckKey);
  if (!cookie || cookie.indexOf("BDUSS=") === -1) {
    console.log("❌ 没找到 CK: 把 CK 粘到脚本顶部, 或先用抓 CK 模式存一次");
    $notification.post("贴吧签到", "", "失败: 没找到 CK (BDUSS), 请先填 CK 或重新抓取");
    $done();
    return;
  }

  try {
    const raw = await httpGet("https://tieba.baidu.com/mo/q/newmoindex", cookie);
    const resp = JSON.parse(raw);
    if (!resp || resp.no !== 0 || !resp.data || !resp.data.tbs) {
      const why = (resp && resp.error) || "接口数据获取失败, CK 可能已失效";
      console.log("❌ " + why);
      $notification.post("贴吧签到", "", "失败: " + why);
      $done();
      return;
    }

    const tbs = resp.data.tbs;
    const forums = resp.data.like_forum || [];
    if (forums.length === 0) {
      $notification.post("贴吧签到", "", "失败: 没读到关注的贴吧列表");
      $done();
      return;
    }

    console.log("📋 共 " + forums.length + " 个贴吧, 开始串行签到");
    let ok = 0,
      already = 0;
    const failed = [];

    for (let i = 0; i < forums.length; i++) {
      const bar = forums[i];
      if (bar.is_sign == 1) {
        already++;
        console.log("✔ 已签到: " + bar.forum_name);
        continue;
      }
      const r = await httpPostSign(cookie, tbs, bar.forum_name);
      if (r.ok) {
        ok++;
        console.log("✅ " + bar.forum_name + " (" + (i + 1) + "/" + forums.length + ")");
      } else {
        failed.push(bar.forum_name + ": " + r.msg);
        console.log("❌ " + bar.forum_name + " " + r.msg);
      }
      await wait(1500);
    }

    let body =
      "共" + forums.length + "个吧: 新签" + ok + "个, 已签" + already + "个, 失败" + failed.length + "个";
    if (failed.length) body += "\n失败: " + failed.slice(0, 10).join("; ");
    console.log("📬 " + body);
    $notification.post("贴吧签到", "", body);
  } catch (e) {
    console.log("❌ 网络请求异常: " + e);
    $notification.post("贴吧签到", "", "失败: 网络请求异常, 检查贴吧是否直连 (别走代理)");
  }
  $done();
}
