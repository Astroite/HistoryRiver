# 《落九川》技术设计文档

> 正式产品名称：《落九川》
> 仓库内部代号：`HistoryRiver`
> 文档状态：P0 技术基线 v0.1  
> 更新日期：2026-07-16  
> 适用阶段：桌面端技术原型、工程验证与性能实验  
> 体验依据：[产品与体验设计文档](./design.md)  
> 当前迭代：[M1-01 核心体验原型](./iterations/current/README.md)

## 1. 文档目的

本文档回答“设计语义怎样进入数据、坐标、状态、渲染与测试”。它不决定历史策展、视觉含义或体验优先级；这些内容以 `design.md` 为准。

内容分为三类：

- **技术基线**：P0 默认按此实现，修改时必须记录原因；
- **验证假设**：需要通过实际原型和数据采样确认；
- **待决策/技术债**：当前没有足够证据定稿，不能伪装成既定架构。

迭代中的临时实现、实验数字和失败记录进入 `docs/iterations/current/work-log.md`。只有复测通过的数值、架构和降级规则才回写本文件。

## 2. 技术目标与非目标

### 2.1 P0 技术目标

1. 用同一套对象 ID、时间与地理坐标生成光瀑远景、斜向入流和俯视切片；
2. 支撑人物光点、完整人生轨迹、策划事件聚散和思想关系四类核心对象；
3. 让 20 年观察窗口控制显影、细节和交互，而不是裁断底层时间数据；
4. 用显式状态机协调自动镜头、用户接管、人物聚焦和思想溯源；
5. 在桌面浏览器中测量帧时间、绘制调用、对象规模、拾取延迟和质量降级；
6. 使用确定性模拟数据复现任何视觉或性能问题；
7. 让低动态、静音和键盘回退路径不依赖后期重写核心场景。

### 2.2 P0 非目标

- 不建立生产级 CMS、账号、云数据库、埋点或发布后台；
- 不尝试全量历史数据抓取或自动生成历史结论；
- 不锁定 WebGPU 专属渲染管线；
- 不实现真实流体、全局光照或高成本物理模拟；
- 不为正式音画资产建立完整制作管线；
- 不用 P0 的模拟规模推断最终全史数据规模。

## 3. 技术决策摘要

| 决策 | P0 基线 | 状态 | 理由/验证点 |
| --- | --- | --- | --- |
| 运行环境 | Node.js ≥ 22.13；M1-01 使用 24.15.0 | 技术基线 | 与当前站点工具链的引擎要求一致 |
| 语言 | TypeScript 5.9.3 严格模式 | 技术基线 | 数据语义复杂，需要在渲染前发现字段和状态错误 |
| 构建与路由 | vinext 0.0.50 + Vite 8.0.13 | 技术基线 | 生成可部署的单路由站点；类型检查独立执行 |
| UI 层 | React 19.2.6 负责语义外壳与状态；DOM/CSS 负责信息层 | 技术基线 | 3D 场景仍由独立命令式渲染器管理，避免逐帧状态进入 React |
| 3D 层 | Three.js 0.185.1 `WebGLRenderer` | 技术基线 | P0 优先稳定的 WebGL 路径，避免把体验验证绑定在 WebGPU 可用性上 |
| WebGPU | 单独实验，不作为 P0 验收前提 | 验证假设 | 可测试未来迁移收益，但不得产生两套业务语义 |
| 场景模型 | 单场景、单数据源、多相机姿态 | 技术基线 | 直接对应“同一条河的三种观看角度” |
| 动画 | 固定逻辑时钟 + 渲染插值 | 技术基线 | 支持回放、拖动年份和确定性测试 |
| 数据 | 本地 JSON/TS 夹具，经校验后进入规范化运行时存储 | 技术基线 | P0 不需要后端，但需要从一开始约束语义 |
| 声音 | Web Audio 状态接口，正式音频后置 | 验证假设 | 先验证状态触发、混合和静音，不绑定正式资产 |
| 自动测试 | 类型检查、数据不变量、状态机测试、构建检查 | 技术基线 | 防止视觉可运行但语义已断裂 |
| 视觉/性能测试 | 固定种子、固定视口、状态截图和浏览器采样 | 技术基线 | 使实验结果可重复比较 |

Vite 官方文档说明其可直接处理 TypeScript，但只负责转译而不做类型检查，因此 P0 的验证命令必须单独运行 `tsc --noEmit`。Three.js 的 `WebGLRenderer` 提供绘制调用、点、线、三角形和资源统计；这些数据可进入原型调试面板。WebGPU 渲染器具备 WebGL 2 后端路径，但本轮仍将 WebGL 作为明确基线，避免兼容回退掩盖实验条件。参考 [Vite TypeScript 说明](https://vite.dev/guide/features.html#typescript)、[Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) 与 [Three.js WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)。

### 3.1 P0 已实现工程切面

```text
app/
  history-river.tsx       三维场景、状态控制、声音占位与指标面板
  page.tsx                单路由入口与页面元数据
  globals.css             幽玄空间、信息层与桌面布局
lib/history/
  model.ts                模拟人物、事件、关系、投影与不变量
tests/
  history-model.test.ts   数据、时间、聚集与导览状态测试
  rendered-html.test.mjs  服务端页面与模板清理测试
```

React 只提交低频体验状态和可访问 DOM；Three.js 在自己的动画循环中读取状态引用、更新 GPU 缓冲与相机。渲染统计通过 `renderer.info` 进入只读指标栏，不反向驱动视觉效果。

## 4. 总体架构

```text
内容夹具 / 模拟生成器
          │
          ▼
    Schema 校验与规范化
          │
          ▼
  History Store（唯一语义源）
     │        │        │
     │        │        └── Evidence / UI View Model
     │        └────────── Timeline Sampler
     └─────────────────── Scene Projection
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
          Render Layers    Picking Index    Audio State
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                    Experience State Machine
                              │
                   Camera Director / User Rig
                              │
                              ▼
                     Metrics & Debug Overlay
```

核心约束：

- 数据层不存储“远景人物”“切片人物”两份副本；
- 场景投影可以生成不同细节等级的 GPU 缓冲，但必须保留源对象 ID；
- 相机状态不得反向修改历史数据，只改变观察窗口与选择状态；
- 音频、字幕和 UI 从体验状态订阅，不从任意渲染对象直接触发；
- 调试层可以读取指标，不参与正式场景布局。

## 5. 坐标、时间与窗口

### 5.1 世界坐标

P0 使用右手坐标系：

- `Y`：历史时间，高处为久远，低处接近 1949 与人民光海；
- `X/Z`：归一化历史地理平面，只表达相对山河方位；
- 世界原点：P0 内容边界在 1949 年对应的光海参考面；
- 相机姿态：三视角只改变投影与相机，不重新解释轴语义。

建议的投影接口：

```ts
type WorldPosition = readonly [x: number, y: number, z: number]

interface ProjectionContext {
  contentEndYear: 1949
  unitsPerYear: number
  geographyScale: number
}

function projectHistoricalSample(
  sample: LifeSample,
  context: ProjectionContext,
): WorldPosition
```

其中时间投影应由单一函数完成，禁止不同图层各自实现年份到 `Y` 的换算。

### 5.2 历史时间表示

长期数据不能用一个无说明的 JavaScript `Date` 表达：

```ts
type EvidenceLevel =
  | 'direct'
  | 'corroborated'
  | 'conflicting'
  | 'inferred'
  | 'contested'
  | 'legendary'
  | 'artistic'

interface HistoricalTime {
  earliestYear: number
  latestYear: number
  displayLabel: string
  precision: 'year' | 'range' | 'period' | 'unknown'
  evidenceLevel: EvidenceLevel
}
```

- 公元前年份的内部约定必须在数据规范中单独说明，不把历史纪年是否存在“0 年”的问题交给界面临时处理；
- 不确定时间保存区间与展示标签，不能先伪精确为单年再靠模糊特效补救；
- P0 模拟数据可使用单年值，但仍通过同一接口进入运行时。

### 5.3 二十年窗口

```ts
interface ObservationWindow {
  startYear: number
  endYear: number
  focusYear: number
  detailFalloffYears: number
}
```

不变量：

- `endYear - startYear === 20`，边界包含规则由实现统一定义；
- `focusYear` 始终在窗口内；
- 窗口控制透明度、细节等级、标签和交互可选性，不删除人物窗口外轨迹；
- 导览速度可随事件密度改变，但年份到世界坐标的比例不随镜头速度改变；
- 时间窗口移动时使用缓动后的视觉值，信息层显示未缓动的真实年份值。

## 6. 核心数据合同

以下字段是 P0 最小合同，不代表最终内容模型。

### 6.1 人物与生命采样

```ts
type EntityId = string

interface Person {
  id: EntityId
  label: string
  life: HistoricalTime
  roles: string[]
  evidenceRefs: EntityId[]
  prototypeOnly: boolean
}

interface LifeSample {
  personId: EntityId
  year: number
  geo: readonly [eastWest: number, northSouth: number]
  geoUncertainty: number
  influence: Partial<Record<InfluenceDimension, number>>
}

type InfluenceDimension =
  | 'overall'
  | 'political'
  | 'military'
  | 'thought'
  | 'culture'
```

约束：

- `influence` 只接受同一量纲内的归一化值，缺失不能自动补为 0；
- `LifeSample` 按人物与年份排序，插值不能越过证据不连续区而不留标记；
- 地理不确定度必须能影响可视化范围，不能只存在信息面板中。

### 6.2 事件

```ts
interface CuratedEvent {
  id: EntityId
  label: string
  time: HistoricalTime
  geo: readonly [number, number]
  participantIds: EntityId[]
  rolesByPerson: Record<EntityId, string>
  evidenceRefs: EntityId[]
  prototypeOnly: boolean
}
```

事件聚集是策展数据驱动的轨迹约束，不是运行时根据距离自动宣布的新历史事件。渲染层可以使用力场或缓动计算聚散外观，但参与者名单和事件时间必须来自内容层。

### 6.3 思想关系

```ts
type ThoughtRelationKind =
  | 'direct'
  | 'documented-indirect'
  | 'scholarly-inference'

interface ThoughtRelation {
  id: EntityId
  sourcePersonId: EntityId
  targetPersonId: EntityId
  activeTime: HistoricalTime
  kind: ThoughtRelationKind
  direction: 'source-to-target' | 'mutual' | 'contested'
  evidenceRefs: EntityId[]
  prototypeOnly: boolean
}
```

思想线的透明度、连续性与运动参数可以由 `kind` 映射，但不得生成“线更亮即更真实”的单一数值语义。

### 6.4 时代视觉参数

```ts
interface EraStyleProfile {
  id: EntityId
  time: HistoricalTime
  baseColor: string
  accentColor: string
  particleMotionProfile: string
  patternFieldProfile: string
  materialProfile: string
  researchRefs: EntityId[]
  prototypeOnly: boolean
}
```

时代参数通过时间连续插值进入光、雾、粒子和 UI 边缘；禁止在朝代边界卸载整套场景并换皮。

### 6.5 来源

```ts
interface EvidenceReference {
  id: EntityId
  title: string
  author?: string
  locator?: string
  url?: string
  evidenceLevel: EvidenceLevel
  note?: string
}
```

正式内容需要进一步定义版本、出版信息、引用段落、策展判断与异说；P0 只验证引用可追踪的接口存在。

## 7. 体验状态机与相机控制

### 7.1 状态

```ts
type ExperienceState =
  | { type: 'river-overview' }
  | { type: 'entering-window'; window: ObservationWindow }
  | { type: 'slice'; window: ObservationWindow }
  | { type: 'event-focus'; eventId: EntityId }
  | { type: 'person-focus'; personId: EntityId }
  | { type: 'relation-focus'; relationId: EntityId }

type CameraAuthority =
  | { type: 'directed'; segmentId: string; progress: number }
  | { type: 'user'; returnAnchor: CameraAnchor }
```

设计状态 S0–S4 与技术状态不要求一一对应；技术状态可以细分事件和过渡，但不能暴露设计上不存在的页面断裂。

### 7.2 事件优先级

1. 用户输入优先于自动镜头；
2. 低动态设置优先于导览预设；
3. 显式返回优先于当前聚焦动画；
4. 窗口变化先更新语义状态，再由渲染层插值追上；
5. 音频与字幕只响应已提交的状态，不响应每帧相机噪声。

### 7.3 接管与返回

- 指针拖动、滚轮、方向键、空格或 Escape 触发用户权威状态；
- 接管时保存 `returnAnchor`，包括视角、观察目标、窗口和选中对象；
- 自动镜头不计时夺回控制，只能发出可忽略的继续提示；
- “返回全史”通过可逆路径插值到河景锚点，不能瞬间传送并丢失原窗口；
- 相机角速度、加速度和近裁剪面进入调试参数，供眩晕测试复用。

## 8. 渲染层设计

### 8.1 层级

| 层 | 内容 | 首选实现 | 语义优先级 |
| --- | --- | --- | --- |
| L0 深空与雾 | 幽玄背景、深度雾、源头云层 | 简化全屏/体积近似 | 可降级 |
| L1 无名之流 | 河体主体与人民光海的装饰性模拟粒子 | 批量点精灵/着色器 | P0 可大幅降采样，但必须标注模拟 |
| L2 人物点 | 可识别人物与影响力大小 | 单缓冲点集或实例 | 不可删除 |
| L3 人生悬丝 | 人物连续时间轨迹 | 批量线段/带状几何 | 不可删除，允许减少细分 |
| L4 事件场 | 聚散约束、波纹和局部水势 | 状态驱动的局部场 | 聚散不可删除，水势效果可降级 |
| L5 思想关系 | 跨人物、跨生命的细亮关系 | 独立批量线集 | 不可删除，允许只强调相关子图 |
| L6 山河与窗口 | 抽象方位轮廓、窗口厚度和时间锚点 | 简化线/面与 DOM 标签 | 不可删除 |
| L7 后期效果 | 辉光、色差、景深等 | 最小后期链 | 优先降级 |
| L8 UI/字幕/调试 | 标签、图例、状态和指标 | DOM/CSS | 关键交互不可删除 |

### 8.2 批处理原则

- 人物、背景粒子、人生线和思想线按材质/状态批处理，避免“一人一个 Object3D”；
- 每个顶点保留实体索引或可回查 ID，用于拾取和调试；
- 标签只为选中、悬停、事件核心和少量上下文对象生成；
- 窗口外对象优先降低亮度和细分，不立即从语义存储删除；
- P0 近景将人生线批为“当前事件参与者”和“外围上下文”两层，只生成观察窗口附近的显示几何；完整生命数据仍保留，并仅在人物聚焦时生成选中者的全轨迹；
- 思想关系依据状态选择性显影：非关系状态只保留可发现的极弱相关子图，关系聚焦时仅高亮当前关系；
- 时代过渡通过统一参数插值，避免在边界重新编译大量材质；
- 正式实现前先用内置统计确认绘制调用与顶点规模，不能只依据肉眼帧率。

### 8.3 拾取

P0 对 12–20 位语义人物可使用 CPU 屏幕空间索引或射线拾取；规模实验需要加入 GPU ID 缓冲或空间索引对比，但不提前锁定。

拾取验收：

- 指针目标半径与视觉点大小分离，避免小光点不可选；
- 遮挡时优先当前窗口、当前年份和视觉前景对象；
- 同一区域多对象时提供候选循环或轻量列表，不随机选择；
- 拾取到的 ID 必须能回查唯一 `Person`，三视角保持一致。

## 9. 确定性模拟与动画

### 9.1 固定实验种子

所有装饰粒子、初始扰动、事件聚散噪声和关系曲线抖动都从显式种子生成。调试面板显示：

- 数据夹具版本；
- 随机种子；
- 当前状态和逻辑时间；
- 窗口起止年与聚焦对象；
- 质量档、视口、像素比和渲染器；
- 每帧统计。

任何截图或性能记录都必须携带这些信息，确保问题可复现。

### 9.2 时钟

- 历史逻辑时间、导览时间和真实帧时间分离；
- 拖动年份只改变历史逻辑时间；
- 暂停导览不暂停必要的环境呼吸动画；
- 性能下降时动画按真实时间推进，不能因掉帧改变事件时序；
- 自动测试可注入固定时间步进并直接跳转状态。

## 10. 性能预算与质量档

以下数字是 M1-01 的验证门槛，不是已证明能力。若未达到，先记录真实结果与瓶颈，再决定调整实现或预算。

### 10.1 目标环境

- 桌面浏览器，1920×1080 逻辑视口；
- 默认像素比上限 1.5，可随质量档降低；
- 一台近年中档独立显卡或性能相近设备作为目标档；
- 一台集成显卡设备作为降级档；
- 浏览器、操作系统、GPU、驱动、视口和电源状态随结果记录，不用“我的电脑很流畅”代替环境信息。

### 10.2 两类数据场景

| 场景 | 用途 | 规模 |
| --- | --- | --- |
| 语义夹具 | 设计走查与交互测试 | 12–20 人、2 事件、3–5 思想关系、完整窗口外轨迹 |
| 规模夹具 | 渲染与降级测试 | 最多 120,000 背景粒子、2,000 人物点、40,000 人生线顶点、10,000 关系/山河线顶点、32 个同时可见标签 |

规模夹具只证明渲染包络，不代表最终产品会包含对应数量的真实人物或关系。

### 10.3 默认档门槛

| 指标 | P0 门槛 | 采样条件 |
| --- | --- | --- |
| 稳态帧时间中位数 | ≤ 16.7 ms | 目标设备，每个核心状态连续采样 30 秒 |
| 稳态帧时间 P95 | ≤ 25 ms | 同上，排除首次加载但不排除正常交互 |
| 严重卡顿 | 单次帧间隔不超过 100 ms | 状态切换和人物拾取过程中记录 |
| 拾取反馈 | 指针输入至高亮 ≤ 100 ms | 语义夹具和规模夹具各测试 |
| 绘制调用 | 默认档稳态 ≤ 100 | 记录核心状态的最大值 |
| 同屏 DOM 标签 | ≤ 32 | 超出后按优先级聚合或隐藏 |
| 首次可交互 | 本地开发构建 ≤ 3 s | 清缓存，记录硬件与构建模式 |

浏览器主线程和 GPU 时间应尽可能分开记录；无法可靠取得 GPU 时间时必须标为“未测”，不能用总帧时间冒充 GPU 指标。

### 10.4 质量降级顺序

1. 降低后期效果质量或关闭景深、色差和多余辉光；
2. 降低像素比和背景雾/云采样；
3. 降低无名之流与装饰粒子密度；
4. 降低人生线和思想线的曲线细分，但保留端点、方向和证据线型；
5. 减少非焦点标签和远景更新频率；
6. 仅在最后降低非窗口、非选中人物的更新频率。

任何质量档都不得删除当前窗口、选中人物、当前事件、当前思想关系、时间方向和返回路径。

## 11. 声音、可访问性与失败回退

### 11.1 声音接口

- 浏览器要求用户手势后才初始化音频上下文；
- 音频状态包含 `muted`、总音量、四层音量与当前时代/事件状态；
- 静音不影响字幕、事件波纹和交互反馈；
- 正式音频前使用短占位素材或合成音验证切换，不将占位素材提交为时代考据结论。

### 11.2 低动态

- 初次进入前读取系统偏好并允许界面覆盖；
- 低动态模式禁用高速穿越、急转、强景深和大幅粒子冲击；
- 体验状态不减少，只用淡入、平移、缩放和明确锚点替代；
- 自动测试至少覆盖正常动态与低动态两条状态路径。

### 11.3 WebGL 失败

若无法建立渲染上下文：

- 显示明确的设备/浏览器能力提示；
- 提供静态概念图与文字信息入口，而不是永久加载动画；
- 记录错误但不上传个人设备信息，除非未来另行获得用户同意；
- P0 不承诺完整 2D 功能等价回退。

## 12. 验证策略

### 12.1 自动验证

| 层级 | 必测内容 |
| --- | --- |
| 类型 | `tsc --noEmit` 独立通过 |
| 数据 | 唯一 ID、引用存在、时间区间、窗口宽度、人物采样排序、模拟标识 |
| 投影 | 年份越久远则 `Y` 越高；同一人物跨视角保持 ID 与连续位置 |
| 状态机 | 用户输入中断导览；返回锚点保留；非法状态转换被拒绝 |
| 构建 | 生产构建通过，无未声明运行时资源 |
| 视觉状态 | 固定种子与视口下输出 S0–S4 基准截图，差异需人工确认 |

### 12.2 手动技术采样

每次结果至少记录：

```text
commit / build:
browser + version:
os / gpu / driver:
power mode:
viewport / device pixel ratio:
renderer / quality tier:
fixture / seed:
state / camera anchor:
sample duration:
median / P95 / max frame interval:
draw calls / points / lines / triangles:
pick latency:
notes / visible artifacts:
```

### 12.3 设计验证接口

技术原型必须提供设计测试所需的固定入口：

- 一键重置到 S0；
- 一键运行 75 秒默认导览；
- 直接跳转 S0–S4，但测试参与者默认不可见；
- 固定模拟数据与种子；
- 可切换正常/低动态、声音开/关、默认/降级质量；
- 可导出或复制当前状态与性能摘要。

具体参与者任务与通过阈值见 [设计文档第 20 节](./design.md#20-p0-设计验证协议)。

## 13. 需求—实现—验证追踪

| 需求 | 技术责任 | 验证证据 |
| --- | --- | --- |
| D-01 三视角同源 | 单一 History Store、Scene Projection、Camera Anchor | 对象 ID/坐标调试 + 三状态截图 + 用户识别 V-01 |
| D-02 窗口不截断人生 | ObservationWindow、窗口外 LOD、LifeSample 插值 | 数据不变量 + V-02/V-05 |
| D-03 事件表现聚散 | CuratedEvent、事件轨迹约束、可回放逻辑时钟 | 事件前中后截图/录屏 + V-03 |
| D-04 两类线可区分 | 独立缓冲与材质、关系类型参数 | 视觉基准 + V-04/V-07 |
| D-05 导览可接管 | Experience State Machine、CameraAuthority、returnAnchor | 状态机测试 + V-06 |
| D-06 时代色从河内显现 | EraStyleProfile 连续插值、统一材质参数 | 边界连续性截图 + 体验量表 |
| T-01 三视角同源 | 单数据源、统一投影函数 | ID 与坐标自动测试 |
| T-02 桌面交互稳定 | 批处理、LOD、指标采集 | 第 10 节性能记录 |
| T-03 可降级 | QualityPolicy 与语义保护名单 | 正常/降级对比和设计复核 |

## 14. 待决策与技术债

### 14.1 M1-01 内必须回答

- `WebGLRenderer` 下点、线与后期效果的真实可用规模；
- 人生悬丝采用原生线段、带状几何还是着色器扩展线；
- 规模夹具下 CPU 拾取、空间索引与 GPU ID 拾取的分界点；
- 窗口外轨迹的细分、透明度和更新频率组合；
- 三视角相机锚点、角速度和低动态参数；
- 默认质量档与降级档的实际帧时间；
- DOM 标签在遮挡、重叠与高缩放范围下的布局策略。

### 14.2 后续迭代再回答

- WebGPU/TSL 是否带来足够收益，是否值得迁移；
- 正式内容 Schema 的版本化、迁移和策展工具；
- 全史数据的流式加载、切片缓存和章节包格式；
- 人民/无名之流的真实数据来源与聚合实现；
- 正式音频解码、分层混合与资源预算；
- 生产级可观测性、错误上报、隐私和内容发布；
- 静态回退、无障碍替代视图与未来移动端架构。

## 15. 工程进入条件与当前状态

开始 `M1-01-T03` 前必须满足：

1. [设计文档第 18 节](./design.md#18-p0-核心体验合同) 未被新的产品决策推翻；
2. 模拟数据规模、事件和关系数量符合当前迭代范围；
3. 工程初始化时锁定 Node、包管理器、Vite、TypeScript 和 Three.js 版本；
4. 建立类型检查、构建与数据不变量测试命令；
5. 先完成 S0–S2 的最短垂直切片，再扩展人物和思想关系；
6. 每完成一个 Task 将结果、验证和阻塞追加到 `work-log.md`。

以上条件均已满足，`M1-01-T03` 于 2026-07-16 完成。单设备性能与交互结果记录在 [当前迭代验证记录](./iterations/current/validation.md)，尚未完成的规模夹具、集成显卡和真实用户观察仍属于 T04，不得视为长期性能结论。

## 16. 技术参考

- [Vite：Getting Started](https://vite.dev/guide/)
- [Vite：TypeScript](https://vite.dev/guide/features.html#typescript)
- [Three.js：WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Three.js：WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)
- [MDN：WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)

参考资料用于核对工具行为，不替代本项目自己的性能实验和设计验收。
