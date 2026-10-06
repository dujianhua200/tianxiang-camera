# 天象云台账 v2 · 飞牛（fnOS）部署包

零依赖思路 + 唯一 npm 包 exceljs（导出嵌图 Excel 用）。功能：设备注册审批、管理后台（概览/台账/地图/设备）、照片墙、CSV / **照片内嵌单元格** 的 Excel 台账导出、按日拍照点位地图。

## 一、部署（飞牛 Docker → Compose 项目）

1. 用本 `cloud` 文件夹作为项目目录（如 `/vol1/1000/docker/cloud`）；
2. 飞牛 Docker → Compose → 新建项目 → 粘贴 `docker-compose.yml` 内容 → 构建并启动（首次构建会 npm 安装 exceljs，需要 NAS 能上网）；
3. **务必修改三个凭据**：
   - `ADMIN_PASSWORD`：管理后台密码（网页登录用）
   - `INVITE_CODE`：邀请码（发给信任的同事，App 里填）
   - `TOKEN`：网页直链查询令牌（可随意）
4. volume 必须是**绝对路径**（`/vol1/...` 开头，别写 `./`），照片就落在你指定的 NAS 目录。

## 二、使用

- 管理后台：浏览器开 `http://NAS_IP:9800` → 输入 ADMIN_PASSWORD 登录
  - 概览：总数/今日/设备统计、每日拍照量、工程分布
  - 台账：按日期/工程/设备/关键字筛选，照片墙或表格视图，删除，**导出 Excel（照片嵌入单元格）** / CSV
  - 地图：选日期看当天所有拍照点位，点标记看照片
  - 设备：新设备用邀请码注册后进入「待审批」→ 点同意才能上传；可随时封禁/解封/删除
- App「水印编辑 → 家云同步」：开关 + 服务器地址 + 邀请码 → 测试连接 → 首拍自动注册，审批通过后自动上传（未通过的暂存队列，批准后重开 App 自动补传）

## 三、数据位置

- 照片：`<volume>/photos/*.jpg`；台账：`<volume>/ledger.jsonl`；设备：`<volume>/devices.jsonl`（全部纯文本/图片，可直接备份迁移）

## 四、外网访问（可选）

- 最简单：飞牛 fn Connect 给该应用开远程访问；
- 有公网 IP/IPv6：DDNS + 端口放行，建议套 HTTPS（后台已有密码+审批双保险，但明文传输仍建议加密通道）。

## 五、不用 Docker 直接跑

装有 Node 18+ 的机器：`npm install && node server.js`，环境变量 `PORT / TOKEN / INVITE_CODE / ADMIN_PASSWORD / DATA_DIR`。
