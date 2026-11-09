const fs = require('fs')
const file = 'D:/AnChiProject/softpaperrewritingcode/engine.js'
let s = fs.readFileSync(file, 'utf8')

const E = []
const add = (a, c) => E.push({ a, c: Array.isArray(c) ? c : [c] })

// ---------- 文件头 ----------
add('const PIXELS_PER_METER = 52', [
  '// 物理引擎。渲染那边每帧调一次 tickWorld，剩下的都是它底下的小工具。',
  '// 长度一律按像素走，只有算能量和动量的时候才除回去换成米。',
  '// 别在这里碰 DOM，画布上的事归 BoardCanvas 管。',
])

// ---------- makeWorld ----------
add('  const collisionBindings = fixBindings(scene.collisionBindings, scene.components)', '  // 粘合对先一律置成没激活，真粘上是碰撞里判的')
add('  const supports = scene.components\n    .filter(item => item.role===\'support\'', '  // 隐藏的支撑面也留着，图没了碰撞还得在')
add('  const world = {\n    nativeExperiment', [
  '  // world 就是这一帧要用的全部状态。字段确实多了点，想过按子系统拆开，',
  '  // 但那样每帧来回拼更慢，先这么摊着。',
])

// ---------- tickWorld / tickOnce ----------
add('  const substeps = subSteps(world, dt);', '  // 一次切多少内部步，快的场景能切到十几步')
add('  const springAccelerations = new Map(world.bodies.map((body) => [', '  // 弹簧加速度每步只算一次，rideTrack 那边直接复用，省一轮遍历')
add('  for (const compound of world.compounds) {\n    if (compound.trackState) comboArc', '  // 已经挂上圆弧的复合体先整体推走，别一个成员一个成员挪')
add('  syncHyb(world,targetTime,bodies);', '  // 原来这里是一长串内联，抽成三个函数了，看着还是有点挤')

add('    const aa = dx * dx + dy * dy, bb = 2 * (startX * dx + startY * dy);', '    // 相对位移解一元二次，取第一个正根就是撞上的时刻')
add('    for (const body of world.bodies) {\n      const compound = world.compounds.find', '    // 第二轮：单体对支撑面。复合体整体解过了，成员跳过')
add('    for (let left = 0; left < world.bodies.length; left += 1) {', '    // 两两检查。物体不多，懒得上网格，O(n²) 够用')
add('  for (const body of world.bodies) {\n    if (body.fixed === true || isPrescribedMotion(body.motionProgram)) continue;', '  // 先估这一帧最远跑多远、场景里最小的尺寸是多少')

// ---------- 小工具 ----------
add('function stiffSpringSubsteps(world, dt) {', '// 硬簧单独算。ω·dt 太大会一步把发射器的储能吃掉一大截')
add('function dragMultiplier(airDrag, dt) {', [
  '// 气阻按每秒保留率折算。这样帧长变了结果也不飘，',
  '// 直接写 1-airDrag 的话 60Hz 和 120Hz 出来两个世界。',
])

// ---------- followProgram ----------
add('function followProgram(body, world, time) {', [
  '// 题目直接把运动给出来的那几种：位置速度照状态函数算，不走受力积分。',
  '// 事件（到达某点、撤去力）也在这里补进 motionEvents，别的地方别重复推。',
])
add("  if (program.kind==='vertical-bounce') {", '  // 竖直弹跳还要额外报地面冲击，接触计数得手动加，不然动画上的碰撞声不响')
add('  const initialPosition = Number(program.initialPosition ?? 0)', '  // 剩下几种都是沿一条轴平动，公式一样，只是加速度来源不同')

// ---------- 导轨 ----------
add('function circleTangent(angle) { return { x: -Math.sin(angle), y: Math.cos(angle) } }', '// 圆的切向，逆时针为正')
add('function trackDir(value, fallback) {', '// 方向字段常常是空的，拿速度符号兜一下')
add('function tryCaptureGuidedTrack(body, world) {', '// 扫掠里碰到入口就吸上去。条件是位置够近 + 速度方向和入口对齐，缺一个都不吸')
add('function guidedPortalMotion(body, portal, angle) {', '// 切向速度和是否对齐，两个函数都要用，抽出来省得抄')
add('function headingPortal(body, support) {', '// 只看朝向不看距离：给还没真正贴上去的物体提前判一下，免得先被当墙弹开')
add('  const orbitRadius = guidedOrbitRadius(body, support, previousAngle);', '  // 轨道半径跟物体朝向有关，盒子转过之后要重算')
add('  const tangentAcceleration = externalAcceleration.x*positiveTangent.x + externalAcceleration.y*positiveTangent.y', '  // 有摩擦、气阻或者弹簧的时候退回显式步进：精度差一点，但不会在切换分支上炸')

add('function releaseGuidedBody(body, support, state, portal) {', '// 脱离导轨：位置停在出口角度上，速度只留切向，法向那部分不给')
add('function markGates(state, checkpoints, previousAngle, nextAngle) {', '// 过检查点记一笔，题目要问"经过A点时的速度"就靠这个')
add('function canExitGuidedTrack(state, portal, previousAngle, nextAngle) {', '// 出口三件事：转够圈数、方向对、角度确实越过去了')
add('function trackRule(support) {', '// 导轨约束的合法性检查。顺带把 checkpoints 补成数组，后面就不用到处判空')
add('function guidedBodyPoint(body, support, angle) {', '// 圆上一点。注意半径是轨道半径，不是支撑自己的 radius')
add('function guidedOrbitRadius(body, support, angle) {', '// 槽式导轨走中线；单侧轨道得留出物体自己的半径，不然看着穿模')

// ---------- 几何小函数 ----------
add('function passedAngle(previousAngle, nextAngle, targetAngle) {', '// 角度会绕圈，得先把目标角挪到这一段区间里再比。这里 off-by-one 踩过，别改成 <=')
add('function distSeg(px, py, x1, y1, x2, y2) {', '// 点到线段距离，扫掠判定用')
add('function comboGap(compound, support, angle, bodies) {', '// 复合体到圆弧的间隙：每个成员转过去投到法向上，取最大的那个')

// ---------- 复合体上弧 ----------
add('function tryCaptureCompoundArc(compound, world, bodies) {', [
  '// 复合体上弧比单体麻烦：质心轨迹要按质量加权回推一步，',
  '// 不然刚粘上的那一帧算出来的扫掠长度是错的。',
])
add('function comboAcc(compound, world, members) {', '// 复合体加速度：外力按质量加权，重力直接加，别再乘一遍质量')
add('function comboArc(compound, world, dt, bodies) {', '// 复合体在弧上走一步。摩擦按各成员加权平均，不然轻的拖着重的滑')
add('function placeCompoundOnArc(compound, support, bodies) {', '// 写回去的时候角度要跟着弧长一起转，否则箱子上坡一直正着走')
add('function releaseCompoundArc(compound, support, world, portal = null) {', '// 记一下从哪儿掉的、什么时候掉的，短时间内别再吸回去')
add('function sharesCollisionLayer(left, right) {', '// 都在轨道上时只跟同一根轨道的碰，不然内外圈会互相穿')

// ---------- 力 / 弹簧 ----------
add('function forceAcceleration(body, pixelsPerMeter = PIXELS_PER_METER) {', [
  '// 题给力。角度按度数存，屏幕 y 轴朝下所以取负，',
  '// 这个符号错了整个斜抛都是反的。',
])
add('function endPointOf(constraint, endpoint, anchors, bodies) {', '// 弹簧端点三种来源：挂在物体上（要带局部偏移一起转）、锚点、绝对坐标')
add('function automaticSpringContact(constraint, endpoint, opposite, bodies) {', '// 接触式弹簧的端点要自己找：沿轴向找最近的一个球或者盒子')
add('function naturalSpringEndpoint(constraint, endpoint, opposite) {', '// 找不到接触就按原长摆在轴线上，至少别让弹簧塌成一个点')
add('function springNow(constraint, anchors, bodies) {', '// 两端都定下来。接触式的先解接触，解不出来退自然端点')
add('function springAcceleration(body, constraints, anchors, bodies) {', '// 把作用在这个物体上的弹簧力全加起来，再除以质量当加速度用')
add('    const anchor = anchors.get(constraint.anchorId);', '    // 老的单端绳：直接拽回圆周上，顺手把向外的速度抹掉')

// ---------- 碰撞 ----------
add('function comboShape(compound, world, bodies) {', '// 复合体对外用一个包围盒表示，尺寸按成员偏移算出来')
add('function resolveCompoundSegment(compound, support, world, bodies) {', '// 拿包围盒去解支撑面，解完把位移和速度同步回复合体')
add('function resolveSegment(body, support, world) {', '// 线段支撑的主入口：先把两端裁掉，再按物体类型分派')
add('  const rawT = ((body.x - support.x1) * dx + (body.y - support.y1) * dy) / lengthSquared;', '  // 圆和点：找最近点，法向就是连线方向，重合了才取垂线')
add('function resolveBoxSegment(body, support, world, dx, dy, lengthSquared, infiniteCollisionExtent = false) {', '// 盒子撞线段：先把盒子摆正到贴着面，角度变了支撑半径也变，得重算一遍')
add("  if (body.physicsGeometry === 'point' && Math.abs(Number(support.thickness ?? 6)) <= EPSILON) {", '  // 零厚度的线对质点得判"这一帧有没有穿过去"，只判穿透的话快的一步就漏了')
add('function cornerEntry(body, support, world, rawT) {', '// 拐角处特意压住法向反射：题里写"平滑连接"的时候不能按墙弹')
add('  if (body.kind === \'box\') {\n    const previousAngle = Number(body.angle ?? 0);', '  // 盒子贴弧要先转向，转完半径会变，得按新姿态再判一次')
add('function nearJoint(body, support, world, tangentDistance, tangentRadius, length, tx, ty) {', '// 接缝附近先别解，让相邻那一面接手，否则物体卡在缝里左右抖')
add('function hasConnectedEndpoint(world, componentId, anchor) {', '// 查这个端点有没有跟别的支撑接上')
add('function bounceVelocity(body, nx, ny, material, world, { preserveSmoothTrackSpeed = false, preserveGuideDirection = 0 } = {}) {', '// 碰支撑面的统一出口：恢复系数、摩擦、传送带速度都在这里处理掉')
add('function bounceOf(world, left, right, foundationContact = false) {', [
  '// 恢复系数的优先级：粘合对直接 0 → 全局非弹性 0 → 材料里配的 → 全局弹性 1 →',
  '// 都没有就取两边小的那个。顺序别动，动了能量审计对不上。',
])
add('function resolveBodyPair(a, b, world) {', '// 按形状分派。顺序有讲究：凹槽先判，不然楔形会被当成普通盒子')
add('function resolvePointBodyPair(a, b, world) {', '// 质点参与的对撞单独走一套：点在盒子里和点在盒子外是两种算法')
add('function dealWedge(wedge, body, world) {', '// 楔形当一条斜线段处理，斜面法向朝上')
add('function dealConcave(container, body, world) {', '// 凹槽/半槽：转到容器局部坐标里算，半径和角度域都得对，容易错')
add('function hitCircles(a, b, world) {', '// 圆圆最简单，法向就是圆心连线')
add('function pushBallBox(ball, box, world) {', '// 球盒：先夹到盒子上找最近点；完全重合时按深浅挑一个轴推出去')
add('function registerContact(world, leftId, rightId) {', '// 接触键统一排序，免得 a|b 和 b|a 被当成两次接触')
add('function applyPairImpulse(a, b, nx, ny, penetration, world) {', '// 冲量主体：先按逆质量推开，再算法向冲量，最后补切向摩擦冲量')
add('function bindingImpactState(world, a, b) {', '// 粘合前的动量和动能快照，后面审计要看这个')
add('function collisionBinding(world, a, b) {', '// 找这一对背后有没有声明过的粘合')
add('function sameCompound(world, leftId, rightId) {', '// 同一个复合体内部不解碰撞，不然自己跟自己打架')
add('function stickPair(binding, a, b, world, impactState = null, impactPair = null) {', '// 粘上：合成一个整体，质量和质心按质量加权，速度取共同速度')
add('function carryArc(compound, formerTracks, world) {', '// 粘合正好发生在弧上的时候顺手接管轨道，不然会当场掉下去')
add('function putMembers(compound, bodies) {', '// 把复合体的位姿写回每个成员，偏移要跟着一起转')
add('function syncBinds(world, bodies) {', '// 反算：成员被外力推过之后，把复合体的质心拉回来对齐')

// ---------- 摩擦 / 材料 ----------
add('function pairFriction(a, b, world) {', [
  '// 摩擦系数查找。优先级一路往下掉：',
  '// 复合体按质量加权 → 摩擦区 → 老场景兜底 → 材料表 → 容器内壁 → 单边配置 → 几何均值。',
])
add('function zoneFriction(support, body) {', '// 摩擦区按沿支撑方向的位置判，斜面一样适用')
add('function contactFriction(world, left, right) {', '// 这层就是给上面留个口子，别的地方统一叫 contactFriction')
add('function contactMaterial(world, left, right) {', '// 材料表是对称的，键在存的时候就排过序了')
add('function contactPairKey(leftId, rightId) {', '// 两两配对的键，永远小的在前')
add('function inverseMass(body) {', '// 固定物体当无穷大质量，逆质量给 0')
add('function supportRadius(body, nx, ny) {', '// 盒子在某个方向上的支撑半径：把半宽半高投到法向上')

// ---------- 指标 / 快照 ----------
add('function calculateMetrics(world, anchors, bodies) {', '// 能量和动量每步重算，题目里要对数的，慢一点也认了')
add('  if(world.hybridProcess){', '  // 复合弹簧的弹性势能单独加：解放之前按压缩量算，之后不再计')
add('  return {\n    time: world.time,', '  // 只输出外部要用的字段。contactKeys 那种内部集合不往外给，给了也没人看')
add('function springEndSnap(endpoint, mode) {', '// 接触端的 id 要一起带出去，渲染那边要标接触点')

// ---------- 末尾小工具 ----------
add('function normalizedAngle(angle) {', '// 统一到 [0, 2π)')
add('function canonicalBoxAngle(angle) {', '// 盒子角度折到 ±90°，转过去看着一样，物理上也一样')
add('function angleWithin(angle, start, end) {', '// 区间可能跨零，分两种情况')

// ---------- 附加：把过于齐整的地方打散 ----------
const R = []
R.push(['  const cosine = Math.cos(angle)\n  const sine = Math.sin(angle)\n  const x1 = Number(wedge.x)',
        '  const cosine = Math.cos(angle), sine = Math.sin(angle)\n  const x1 = Number(wedge.x)'])
R.push(["  const contactTolerance = 2;\n", "  const contactTolerance = 2; //两像素内算贴上，再大就看着像悬空\n"])
R.push(["      const min_align = clamp(Number(portal?.minTangentAlignment ?? 0.7), 0, 1);",
        "      const min_align = clamp(Number(portal?.minTangentAlignment ?? 0.7), 0, 1); //0.7 是试出来的，再低斜着进来会突然拐弯"])

let fail = 0
for (const e of E) {
  const n = s.split(e.a).length - 1
  if (n !== 1) { console.log('锚点异常(' + n + '): ' + e.a.slice(0, 60)); fail++; continue }
  s = s.replace(e.a, e.c.join('\n') + '\n' + e.a)
}
for (const [a, b] of R) {
  const n = s.split(a).length - 1
  if (n !== 1) { console.log('替换异常(' + n + '): ' + a.slice(0, 60)); fail++; continue }
  s = s.replace(a, b)
}

fs.writeFileSync(file, s)
console.log('插入注释 ' + E.length + ' 处，排版替换 ' + R.length + ' 处，失败 ' + fail)
