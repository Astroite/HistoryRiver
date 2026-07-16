# 落九川

《落九川》是一件从今天仰望中国历史长河的互动数据艺术作品。当前仓库（内部代号 `HistoryRiver`）处于 P0 原型阶段，使用明确标注的模拟数据验证“远看是河、近看是人、俯看是山河”的同源三维体验。

## Prerequisites

- Node.js `>=22.13.0`

## 本地运行

```bash
npm install
npm run dev
```

打开开发服务器输出的本地地址。首阶段只面向桌面浏览器。

## 验证

```bash
npm run lint
npm test
```

`npm test` 依次执行类型检查、历史模型不变量、生产构建和服务端页面验证。

## 文档入口

- 产品与体验：[docs/design.md](./docs/design.md)
- 技术基线：[docs/tech.md](./docs/tech.md)
- 当前迭代：[docs/iterations/current/README.md](./docs/iterations/current/README.md)

当前 P0 不是正式历史内容。人物、事件、关系、影响力与地理位置均为验证交互语义而制作的确定性模拟夹具。

## 技术栈说明

构建与路由使用 [vinext](https://www.npmjs.com/package/vinext)——把 **Next.js App Router 跑在 Vite 之上**并部署到 Cloudflare Workers。因此本仓库同时存在 `next` 与 `vite` 依赖/配置：`vite.config.ts` 是实际生效的构建配置，`next.config.ts` 是 vinext 复用的 Next 兼容配置，`eslint-config-next` 与 tsconfig 的 `next` 插件同理。这并非混用两套构建系统。

目录约定：

- `src/app/`——App Router 页面与三维场景（`history-river.tsx`）；
- `src/lib/`——领域模型与确定性模拟数据（`history/model.ts`）；
- `src/worker/`——Cloudflare Worker 部署入口；
- `tooling/`——自定义 Vite 构建插件；
- `tests/`、`docs/`——测试与文档。
