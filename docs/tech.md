# 《落九川》技术与年度人物数据合同

> 状态：M2 技术基线 v1.1
> 更新日期：2026-07-20
> 产品语义：[design.md](./design.md)

## 1. 工程基线

| 区域 | 当前选择 |
| --- | --- |
| 运行环境 | Node.js ≥ 22.13；当前验证为 22.22.2 |
| 语言 | TypeScript 5.9 严格模式 |
| 页面/构建 | React 19、vinext、Vite 8 |
| 3D | Three.js WebGLRenderer、ACES、Bloom |
| 数据源 | 可审查 JSON |
| 规范数据库 | Node 内置 SQLite，Schema migration v1 |
| Web 产物 | 确定性 JSON；完整年度数据、年度切片和紧凑渲染数据分离 |

页面是带「观河体验层」的三维视觉运行时。React 挂载场景与体验层界面；Three.js 自己管理渲染循环、纯鼠标相机、Resize、质量档、低动态偏好和资源释放。

## 2. 历史时间合同

- BCE 用负整数，CE 用正整数，0 非法；
- `historicalYear` 用于历史语义；
- `yearIndex` 从 0 单调递增，用于排序、唯一约束和 GPU 属性；
- `-1` 的下一年是 `1`；
- 公元前 2700 年是索引 0，1949 年是索引 4648；
- 全范围恰有 4,649 个有效年；
- 年份到世界 Y 坐标只调用 `historicalYearToY()`。

`src/lib/history/model.ts` 是唯一换算实现。地理背景也使用同一组 `historicalYears()`，因此不再生成公元 0 年轮廓。

## 3. 领域合同

### 3.1 规范源记录

- `DatasetManifest`：数据版本、边界、纪年规则和选人政策；
- `EraRecord`：11 个连续覆盖单元；
- `SourceRecord`：标题、作者/机构、出版者、定位、URL、类型和访问日期；
- `PersonRecord`：稳定 ID、名称、异名、年代状态、轨迹边界、领域、入选理由和来源；
- `TrajectoryObservation`：人物、时间范围、可选地域、摘要、证据状态和来源；
- `InterpolationRule`：两个端点观察、起止年、方法、不确定度和说明。

### 3.2 年度派生记录

```ts
interface PersonYear {
  id: string
  personId: string
  historicalYear: number
  yearIndex: number
  lifeState: "active" | "possibly-active" | "outside-range" | "unknown"
  location: HistoricalLocation | null
  derivation: "attested" | "bounded" | "interpolated" | "unknown"
  observationRefs: string[]
  interpolationRuleId: string | null
  uncertainty: number
}
```

```ts
interface YearSlice {
  historicalYear: number
  yearIndex: number
  personYearIds: string[]
  coverage: "curated" | "partial" | "empty" | "unreviewed"
  datasetVersion: string
}
```

`(person_id, year_index)`、`(person_id, historical_year)` 和年度索引均唯一。未知位置必须为 `NULL`；插值必须引用规则；SQLite CHECK、外键和构建校验共同保证这些不变量。

## 4. 数据管线

```text
data/history/source/*.json
          │ validate + materialize
          ▼
data/history/build/history.sqlite   可删除、忽略提交
          │ deterministic export
          ▼
src/data/history/generated/
  annual-person-years.json          完整年度人物查询产物
  year-slices.json                  全 4,649 年反向索引
  render-data.json                  浏览器紧凑元组
  build-report.json                 摘要、数量和覆盖报告
```

`scripts/build-history-data.ts` 每次从空库执行 `001_initial.sql`，在事务中导入规范记录和派生年度记录，然后运行外键、完整性、数量和零年检查。`npm run data:check` 重建数据库并逐字比较 Web 产物，确保提交的产物没有过期。

SQLite 二进制不是内容真源，不进入 Git。新增 Schema 必须增加迁移并更新构建器，不能运行时猜字段。

## 5. 来源准入

M2 允许四类来源：原始文献的可定位数字版本、学术出版物、具名参考工具、博物馆/大学等机构记录。每个人物至少有身份/年代来源，每条有位置的观察至少有来源。URL 只是定位信息，证据状态仍需单独记录；原始史书并不自动等于现代精确年代。

传说人物使用 `traditional`，年代争议人物使用 `disputed` 或 `estimated`。仅有宽泛地域依据时提高不确定度，不扩写为逐年移动。

## 6. 渲染投影

构建器把完整 `PersonYear` 压缩为浏览器元组：人物索引、历史年、年索引、可选 X/Z 和不确定度。`buildRenderPersonThreadGeometry()` 按人物分组，连接相邻 `yearIndex`，并给每个顶点写入人物索引与年索引。

位置未知时，渲染器使用由人物 ID 确定的稳定河道；该偏移只存在于视觉投影。观察位置只以不确定度加权的小幅偏移进入河形，不声称精确地理复原。

正式场景以固定基准机位启动，并由独立的 `RiverCameraControls` 处理纯鼠标视口导航：左键拖拽环绕枢轴（带惯性阻尼），右键/中键拖拽平移，滚轮在 clamp 距离内推拉，双击回到作品全景；不使用 Pointer Lock 与键盘。控制器不读取人物数据，不做 Raycast，也不持有选择或时间状态；人物识读由场景侧按屏幕投影采样实现。

环境材质可以缓慢流动；`prefers-reduced-motion` 会冻结或减弱流动，但不禁用用户主动控制的相机。开发环境提供只读 `window.__historyRiverDiagnostics` 供外部截图/采样脚本读取，不创建 UI 或产品交互，生产构建不保留该对象。

## 7. 已删除架构

M1 的 `ExperienceState`、75 秒时间表、自动相机锚点、观察窗口、人物/关系选择、Raycaster、拾取 Pointer、键盘产品命令、URL `?view=`、OrbitControls、模拟事件和思想关系夹具不再是技术基线。M2-02 新增的 Pointer/Mouse/Keyboard 监听只改变相机，不恢复上述产品架构。

## 8. 测试与指标

```bash
npm run data:build  # 重建数据库与产物
npm run data:check  # 重建并比较确定性产物
npm run typecheck
npm run test:model
npm run test:camera
npm run build
npm run lint
npm test
```

模型测试覆盖纪年往返、跨 BCE/CE、年度唯一性、双向成员索引、未知位置、显式插值、悬空来源、观察重叠、确定性、顶点身份、地理年度切片与海洋流场。相机测试覆盖纯鼠标手势映射、枢轴环绕与阻尼静止、平移不旋转、滚轮推拉限距、双击回全景，以及释放与 dispose 时的清理。

M2 固定视口软件 WebGL 记录：1920×1080 截图构图通过；场景 54 次绘制、13 个几何、15 个纹理。SwiftShader 样本帧时约 1.7 秒 P50，明确不代表目标 GPU，作为失败/环境受限样本保留。生产客户端主块约 687 kB，仍超过 500 kB 警告线；紧凑渲染产物已把该块从接入完整年度 JSON 时的约 1.17 MB 降低，但 Three.js/视觉主块后续仍需拆分或进一步测量。

## 9. 扩充流程

1. 在 `sources.json` 增加可定位来源；
2. 在 `people.json` 增加人物与入选理由；
3. 在 `observations.json` 增加稀疏、来源化观察；
4. 只有确有理由才在 `interpolations.json` 增加规则；
5. 运行 `npm run data:build`；
6. 审查 `build-report.json`、完整人物年度产物和相关测试；
7. 提交源数据、迁移/构建器改动及确定性 Web 产物，不提交 SQLite 二进制。
