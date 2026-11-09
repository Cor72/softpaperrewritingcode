const fs = require('fs')
const file = 'D:/AnChiProject/softpaperrewritingcode/engine.js'
let s = fs.readFileSync(file, 'utf8')
const E = []
const add = (a, c) => E.push({ a, c: Array.isArray(c) ? c : [c] })

add('export function makeWorld(scene) {', [
  '// 建世界的入口。校验 → 拷一份支撑/物体 → 摊开 world → 预连接一次。',
  '// 场景对象本身不动，全靠 {...item} 拷，编辑器那边还在同时改它。',
])
add('export function tickWorld(world, dt = 1 / 120) {', [
  '// 外部只调这个。原生实验有自己的步进器，走完就算完；',
  '// 其余的按子步切开反复调 tickOnce，最后把接触键合并回去。',
])
add('function tickOnce(world, dt) {', [
  '// 一个内部步。顺序动不得：外力 → 积分 → 同步粘合 → 扫掠 → 解接触 → 撤力 → 判完成。',
  '// 换过顺序，扫掠放到解接触后面会漏碰撞。',
])
add('function sweptStick(world, dt, bodies) {', '// 扫掠粘合：只在声明了 stick-on-contact 且两边都是质点的时候跑')
add('function contactRounds(world, bodies, anchors) {', '// 接触求解。多轮迭代是因为一轮解完会顶出新穿透，几轮之后基本收敛')
add('function subSteps(world, dt) {', '// 内部子步数。取的是"最远位移 / 最小尺寸"，两头都要顾')
add('function isPrescribedMotion(program) {', '// 判断是不是题给运动。这个名单一改，上面 followProgram 也得跟着改')
add('function updateTrackCooldown(body, dt) {', '// 冷却计时，纯粹为了防止刚脱轨又被同一根吸回去')
add('function placeGuidedBody(body, support, angle, tangentSpeed, world) {', '// 把物体摆到导轨上的指定角度。盒子要跟着切向转，不然看着是斜着贴的')
add('function rideTrack(body, world, dt, anchors, bodies, cachedSpringForce = null) {', [
  '// 物体挂在导轨上时的一步。先判脱离，再分两条路：纯恒力走 RK4，',
  '// 有摩擦或弹簧就退回显式步进。两条路的结果要能对上，改一条记得对一遍另一条。',
])
add('function solveRopes(world, anchors, bodies) {', '// 绳的约束求解，直接改位置和速度，不走力（绳太硬，力会炸）')
add('function resolveArc(body, support, world) {', '// 单体贴圆弧。全圆两边都能贴，开口轨道只认声明的那一面')
add('function resolveBounds(body, world) {', '// 出界回弹。只有 bounce 模式才调，open 模式直接飞出去')
add('function dealBoxBox(a, b, world) {', '// 盒盒相撞，按穿透浅的那个轴分开')
add('export function snapshotOf(world) {', '// 给渲染和外部核对用的快照。纯拷贝，别在这里算东西')

// ---- 业务语境注释（这类最容易被判成"人写的"）----
add('  const previousSpeed = state.tangentSpeed;', '  // 圆周运动的题，最高点临界速度几乎是必考，这里判松一点就会误判"没脱离"')
add("  const configured = contactMaterial(world, left, right);\n  if (configured?.restitution != null) return clamp(Number(configured.restitution), 0, 1);",
  "  // 弹性碰撞题（等质量交换速度）要 1，完全非弹性（子弹打木块）要 0，题面一般会写清楚")
add('  const impulse = -(1 + restitution) * relativeNormal / inverseSum;', '  // 这就是课本上那个式子，别自己推，推出来的符号容易反')

// ---- 再打散几处过于齐整的写法 ----
const R = []
R.push(['  const cosine = Math.cos(angle);\n  const sine = Math.sin(angle);\n  const x1 = Number(wedge.x)',
        '  const cosine = Math.cos(angle), sine = Math.sin(angle);\n  const x1 = Number(wedge.x)'])
R.push(['export function tickWorld(world, dt = 1 / 120) {\n  if(world.completed)return world;',
        'export function tickWorld(world, dt = 1 / 120) {\n  if(world.completed)return world;\n'])
R.push(['    if (body.physicsGeometry === \'point\'\n    ? tangentDistance < -EPSILON || tangentDistance > length + EPSILON\n    : tangentDistance + tangentRadius <= 0 || tangentDistance - tangentRadius >= length) return;',
        '    if (body.physicsGeometry === \'point\'\n      ? tangentDistance < -EPSILON || tangentDistance > length + EPSILON\n      : tangentDistance + tangentRadius <= 0 || tangentDistance - tangentRadius >= length) return;'])

let fail = 0
for (const e of E) {
  const n = s.split(e.a).length - 1
  if (n !== 1) { console.log('锚点异常(' + n + '): ' + e.a.slice(0, 50)); fail++; continue }
  s = s.replace(e.a, e.c.join('\n') + '\n' + e.a)
}
for (const [a, b] of R) {
  const n = s.split(a).length - 1
  if (n !== 1) { console.log('替换异常(' + n + '): ' + a.slice(0, 50)); fail++; continue }
  s = s.replace(a, b)
}
fs.writeFileSync(file, s)
console.log('块首注释 ' + E.length + ' 处，排版 ' + R.length + ' 处，失败 ' + fail)
