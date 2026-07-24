# 落九川

《落九川》是一件从今天仰望中国历史长河的数据艺术作品。当前 M2 基线以人物为第一记录单元、以历史年为统一切片单位：公元前 2700 年至 1949 年共有 4,649 个有效年度切片，第一版跨时代核心数据包含 44 位人物和 2,768 条人物年度状态。

正式运行时由纯视觉场景与「观河体验层」构成：序章题字、右侧纪年轴（随相机高度显示所望历史年，点按时代沿河长滑行）、人物丝线悬停名签与点取「人物志」、按时代分组的人物名录。相机为纯鼠标导航：左键环绕、右键/中键平移、滚轮推拉、双击回全景。M1 的自动导览、五状态流程、自动镜头、事件点云、思想关系线、产品快捷键和 OrbitControls 已删除；星空、云雾、天河、入海口、人民光海、年度地理背景、材质与后处理继续保留。场景组件调试菜单仅在 `?debug` 下出现。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run data:build
npm run dev
```

`data:build` 从可审查 JSON 源数据重建 SQLite 规范库和 Web 产物。SQLite 文件位于忽略提交的 `data/history/build/`，不是唯一数据源。

## 验证

```bash
npm run data:check
npm run lint
npm test
```

`npm test` 依次检查确定性数据构建、类型、年度人物模型、地理/海洋几何、生产构建和纯视觉页面合同。

## 数据入口

- 可审查源数据：`data/history/source/`
- SQLite 迁移：`data/history/migrations/`
- 数据构建器：`scripts/build-history-data.ts`
- Web 产物：`src/data/history/generated/`
- 领域合同与视觉投影：`src/lib/history/model.ts`

当前 44 人是跨时代启动数据，不是完整人物库，也不代表人口或客观历史重要度。史料不足的年度位置保持 `unknown`；任何插值都必须单独记录规则、端点观察和不确定度。

## 文档入口

- 产品与数据语义：[docs/design.md](./docs/design.md)
- 技术与数据合同：[docs/tech.md](./docs/tech.md)
- 视觉基线：[docs/visual-design.md](./docs/visual-design.md)
- 历史地理背景说明：[docs/geography-data.md](./docs/geography-data.md)
- 最近归档：[M2-01 年度人物轨迹数据库与河流重构](./docs/iterations/archive/M2-01/README.md)
- 上一归档：[M1-01 核心体验原型](./docs/iterations/archive/M1-01/README.md)

## 工程结构

- `src/app/`：单页纯视觉 Three.js 场景；
- `src/lib/history/`：年度人物领域模型、地理背景和海洋流场；
- `src/worker/`：Cloudflare Worker 入口；
- `data/history/`：源数据、迁移和可删除数据库产物；
- `scripts/`：确定性数据构建；
- `tests/`、`docs/`：合同验证与长期文档。

构建与路由使用 vinext（Next.js App Router 运行在 Vite 之上），部署目标为 Cloudflare Workers。
