# 滑洲天象七星 · 地图集成工程相机

现场工程拍照工具：手机端拍摄自动叠加时间 / 地址 / 经纬度 / 海拔 / 天气 / 工程名称水印，
桌面端批量加水印、自建云台账汇总归档。通信线路施工、巡检、验收的影像证据链工具。

**版本**：v1.01（对外版本号；npm 侧为 1.0.1，见下文说明）

## 组成部分

| 目录 | 说明 | 运行方式 |
|---|---|---|
| `src/` + `index.html` | 手机 App 本体（React + Leaflet 地图，单文件构建） | `npm run dev` / `npm run build` |
| `android/` | Android 壳（WebView + 相机/定位/相册/家云同步原生桥） | `android/build_apk.sh` 或 CI |
| `pc/` | 桌面批量水印台账工具（Electron，Windows 便携版） | `cd pc && npm run win` |
| `cloud/` | 家云台账服务（Node，照片上传/审批/地图/Excel 导出） | `docker compose up` |

手机端 = 现场拍摄（水印相机 + 地图定点 + 家云同步）；
桌面端 = 批量处理（批量水印 + 台账整理）；
云端 = 汇总归档（设备审批 + 照片墙 + 嵌图 Excel 导出）。

## 快速开始

```bash
# 1. 网页/App 本体
npm ci && npm run build          # 产物 dist/index.html（单文件）

# 2. Android APK（本机，需 Android SDK + JDK）
cp -r dist/* android/assets/www/ # 首次需手动拷入
bash android/build_apk.sh

# 3. 桌面端（Windows 便携版）
cd pc && npm ci && npm run win

# 4. 云台账（飞牛 NAS / 服务器）
cd cloud && cp docker-compose.yml my.yml  # 按需改端口/密码
docker compose up -d
```

## 安全必读（公开发布后尤其重要）

1. **高德 Key 不再内置**：v1.01 起源码不含任何 Key。地址精确解析需在
   App「水印编辑 → 地点」填入自己的高德 Web 服务 Key（console.amap.com 免费申请），
   或构建时注入 `VITE_AMAP_KEY` 环境变量。不填则自动回退免费逆地理服务。
2. **云台账默认口令必须改**：`cloud/server.js` 的 `TOKEN / INVITE_CODE / ADMIN_PASSWORD`
   默认值（`tianxiang2026 / tx888 / admin888`）只是占位，部署时务必用环境变量覆盖，
   否则任何知道本仓库的人都能读你的台账。
3. **APK 签名**：仓库内 `android/debug.keystore` 为调试签名，保证各版本升级签名一致。
   对外分发请生成正式 keystore 替换，并从仓库移除调试 keystore。
4. **WebView 调试**：发布版默认关闭 `setWebContentsDebuggingEnabled`，联调时再打开。

## 构建与发布

- CI（`.github/workflows/build.yml`）：push/PR 做编译检查；打 `v*` tag 后自动构建
  Web 单文件、Android APK、Windows 便携版，并创建 GitHub Release。
  如需构建时 baked-in 高德 Key（不进源码），在仓库 Settings → Secrets 配 `AMAP_KEY`。
- 发版：`git tag v1.02 && git push origin v1.02`，其余全自动。
- 版本号映射：对外版本 `1.01`（tag / Android versionName / App 内显示）；
  npm/electron 侧用 semver 兼容的 `1.0.1`（工具链要求三段式）。

## v1.01 审查修复（2026-10-07）

把源码通读后修掉的逻辑问题：

- 🔴 **高德 Key 硬编码**：公库会泄露 Key 被刷量 → 改走用户自填 / `VITE_AMAP_KEY` 构建注入。
- 🔴 **`MapPanel.tsx` 语法错误**：`');` 把语句提前终止、`.trim()` 悬空，tsc/vite 均编译不过
  → 已修复；顺带让注释里声称支持的 `27.9"N 116°` 格式真正能解析（引号作度符号）。
- 🔴 **云台账删除接口越权**：只读 TOKEN 就能删照片 → 改为必须管理会话。
- 🟠 **补传队列先删后传**：上传中途杀进程会丢照片 → 改为全部走完才写回失败项。
- 🟠 **相册导入水印位置失真**：导入旧照片时水印经纬度/地址用的是"当前定位"
  → 新增 EXIF GPS 解析，优先用照片原始 GPS + 单独逆解析地址并提示。
- 🟡 **台账"今日"统计用 UTC**：北京时间 0–8 点算到前一天 → 改按 Asia/Shanghai 取日期。
- 🟡 **邀请码错误也被当"连接失败"重试**：`bad-invite` 走换线路重试白白多等 → 视为业务错误直接返回。
- 🟡 **WebView 远程调试常开**：发布版默认关闭。
- 🟡 **AndroidManifest 缺 versionCode/versionName**：补 `101 / 1.01`。
- 🟡 **水印位置设置对部分样式无效**：hero/strip 样式位置固定 → 编辑面板加提示。
- 🟡 **切回 GPS 丢海拔/精度**：`lastGps` 只存经纬度 → 改存完整 GeoPoint。
- 🟡 **`finalizeShot` 变异 state 对象**：先算完相册落盘再组装不可变对象。
- 🟡 **`cloud/cloud 2/cloud 3/cloud 3_副本` 四份重复**：仅监听地址与 docker 网络模式不同
  → 合并为一份（IPv6 双栈优先、失败回退 IPv4，`network_mode: host`）。
- 🟡 **`build_apk.sh` 硬编码本机路径**：改为环境变量可覆盖，CI 可用。

## 功能路线图（以工程人员视角）

手机端（现场拍摄）与桌面端（整理归档）职责不同，按此分工演进：

**手机端 —— 现场不添乱、证据不作假**
- 杆号/桩号快速关联：拍摄前选杆号，照片自动归入该杆；支持扫杆号牌二维码关联
- 拍摄任务清单：按"今日巡检杆段"下发任务，拍完打勾，防漏拍
- 离线地图包：野外无信号时地图定点可用（当前依赖在线瓦片）
- 强制水印项（防作弊模式）：时间+经纬度不可关闭，满足监理审计要求
- 语音备注转文字：戴手套不便打字时用
- 陀螺仪水平仪：立杆垂直度拍摄辅助

**桌面端 —— 批量快、台账齐**
- 批量改名：`工程_杆号_时间_序号` 一键规范命名
- 水印 vs EXIF 一致性校验：水印时间/坐标与照片 EXIF 比对，揪出作假照片
- 拍摄点地图分布：一天的拍摄点在地图上成轨迹，漏段一目了然
- 竣工影像资料表：按监理格式一键导出 Excel/PDF
- 漏拍检查：同一杆号多角度是否齐全

## 许可证

MIT
