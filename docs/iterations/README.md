# 迭代工作流

当前迭代放在 `docs/iterations/current/`，完成后整体归档到 `docs/iterations/archive/MN/`。

当前无活跃迭代。最近归档：[M2-01 年度人物轨迹数据库与河流重构](./archive/M2-01/README.md)（2026-07-18，含明确性能限制）；上一归档：[M1-01 核心体验原型](./archive/M1-01/README.md)（2026-07-18，有保留项）。

## 阶段契约

1. **讨论**：在 `current/plan.md` 明确任务上下文、范围、依赖与可执行验收。
2. **执行**：执行前阅读 `plan.md` 与 `work-log.md`；每完成一个 Task，追加结果、验证与阻塞。
3. **收尾**：逐项验收，只接受范围内修复；同步结果后归档整个 `current/`。

## 目录契约

```text
docs/iterations/
  README.md
  current/
    README.md
    plan.md
    work-log.md
  archive/
    MN/
```

## 执行约束

- 同一时间只保留一个活跃迭代；`main` 保持稳定。
- Task 必须包含足够上下文，可独立执行，并具有可验证的完成条件。
- 重要决策、实质改动、验证结果和阻塞必须写入 `work-log.md`。
- 超出当前 Task 的需求回到讨论阶段，不顺带扩大范围。
