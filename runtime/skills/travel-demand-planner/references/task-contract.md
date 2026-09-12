# 文旅任务数据契约 v2

任务顶层固定为 `schemaVersion: 2`，包含 UUID `taskId`、非负 `revision`、`demo`、`evaluationDate`、`request`、1–100 条 `resources`、0–200 条 `facts`、0–300 条 `transfers` 和 0–20 个 `plans`。运行 trace、模型配置和密钥不得写入任务。

`request` 使用稳定 `destinationId`，包含业务日期、人数、预算、天气、兴趣、原始饮食/无障碍说明，以及逐日 `dayWindows`。每个窗口明确 `minActivities` 和 `requiredMeals`。`requiredNights` 与 `selfArrangedNights` 互斥并覆盖全部夜晚。饮食需求结构化为排除过敏原、交叉接触控制和餐型；无障碍需求结构化为轮椅路线、无台阶、无障碍房间和无障碍车辆。不能结构化的条件放入 `unresolvedRequirements`。

事实卡包含 `id, resourceId|null, topic, text, sourceLabel, sourceUrl|null, observedAt, validFrom|null, validTo|null, status, demo`。`status` 仅为 `confirmed|unknown|conflict`。结构化资源的价格、开放、容量和适配字段分别引用事实 ID；来源名称不等于已确认。过期、冲突和关键日期缺失均进入待核实。

资源类型为 `activity|stay|meal|transfer`。过敏原、交叉接触、餐型与无障碍能力使用 `yes|no|unknown`，没有字段即 unknown。住宿资源代表房型，使用 `capacityPerRoom` 和 `accessibleRoomsAvailable`。价格支持：

- `ticket`：各年龄票价 × 对应人数 × 使用次数。
- `per_person`：单价 × 全部同行人数 × 次数。
- `per_room_night`：单价 × 房间数 × 覆盖晚数。
- `fixed`：单价 × 服务数量。

缺失价格不按 0 计算：报告已知小计与缺口，总价不完整的方案不参与最低价排序。

普通行程项包含 `itemId, resourceId, day, start, quantity, mealSlot|null`。住宿单列为 `stays`，含房间数、入住日/时刻和退房日。交通是显式有向边，包含起终资源、交通/步行分钟、计费方式、金额、可选服务资源与证据。不同资源间缺边时进入待核实，不能默认 0。

内部结论为 `eligible|pending|rejected`，界面分别显示“通过已录入条件校验”“待核实”“不满足”。硬冲突优先于未知。每条问题包含稳定 code、severity 和字段/资源/日期/证据定位。确认及交付物必须绑定当前 `taskHash + selectedPlanId + confirmationId`。
