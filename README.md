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
