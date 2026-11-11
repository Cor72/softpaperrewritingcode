import { checkMotionPrograms } from './motionProgramContract.js'
import {isRehearsalStageLaw} from '../../shared/rehearsalLaws.js'
import {schoolProcessStateAt} from './schoolProcess.js'
import { finiteRailChainStateAt } from './finiteRailChain.js'
import { carrierEntryStateAt } from './carrierEntryStage.js'
import {hybridStateAt} from './hybridProcess.js'
import {loopCarrierStateAt} from './loopCarrierComposition.js'
import {criticalLoopStateAt}from'./criticalLoopPassage.js'
import { fixBindings } from './collisionBindingContract.js'
import {energyStagesOf} from './carrierEnergySolver.js'
import { checkCarrierScene } from './carrierEnergyVerifier.js'
import {verticalBounceStateAt} from './verticalBounceEvidence.js'
import {checkBounceScene} from './verticalBounceVerifier.js'
import {verifyNativeExperiment} from './nativeExperiment.js'
import {constraintChangeFamilies,stepConstraintChange} from './constraintChangeExperiment.js'
import {springShuttleFamily,stepSpringShuttle} from './springShuttle.js'
import {inclinePlankPassageFamily,stepInclinePlank} from './inclinePlankPassage.js'
import {observePathCrossings} from './pathObservationEvents.js'
// 物理引擎，tickWorld是渲染帧,其他函数是小工具
//不要动这里的DOM，别问为什么，要动画布去BoardCanvas
const PIXELS_PER_METER = 52
const EPSILON = 1e-7;
const MAX_INTERNAL_SUBSTEPS =32;
const G_EPS =1e-9;//之前防NaN用的，不过现在用不上了

/**
 * 获取物体的质量
 * @param {object} body 物体
 * @returns {number} 物体质量
 */
const bodyMass = body => Number.isFinite(Number(body?.mass)) && Number(body.mass) > 0
  ? Number(body.mass) : 0.05;

// 世界入口
// {...item}拷贝
export function makeWorld(scene) {
  if (!verifyNativeExperiment(scene).valid) throw new Error('原生实验跟场景错位');
  checkMotionPrograms(scene);
  if (!checkCarrierScene(scene).valid) throw new Error('储能运动和当前场景对不上')
  if (!checkBounceScene(scene)) throw new Error('反弹运动和当前场景对不上')
  // 粘合状态设置成没激活
  const collisionBindings = fixBindings(scene.collisionBindings, scene.components)
    .map(binding => ({
       ...binding, active:false, offset:null
      }))
  const pixelsPerMeter = Math.max(24, Math.min(260, Number(scene.pixelsPerMeter ?? PIXELS_PER_METER)))
  // 隐藏的支撑面,也就是图
  const supports = scene.components
    .filter(item => item.role==='support' && item.collisionEnabled!==false)
    .map(item => ({
      ...item }))
  const bodies = scene.components
    .filter(item => item.role==='body'
      && !(item.sceneRole==='background'
      && item.collisionEnabled===false))
    .map(item => ({
      ...item,
      asleep:false,
      trackState:null,
      trackCooldown:null, lastTrackExit:null,
    }))
  const prescribedDurations = bodies
    .map(body => isPrescribedMotion(body.motionProgram) ? Number(body.motionProgram.duration): null)
    .filter(duration =>Number.isFinite(duration) &&duration >= 0)
  //演示走完结束
  const playbackDuration =Number(scene.constructionPlan?.playbackDuration)
  if (Number.isFinite(playbackDuration)&&playbackDuration >0){
    prescribedDurations.push(playbackDuration);
  }
  // world是这一帧要用的全部状态
  // TODO:字段确实多了点，后面看要不要按子系统拆开
  const trackRule =schoolProcessStateAt(scene.railProcess, scene.components);
  const world = {
    nativeExperiment:scene.nativeExperiment?? null,
    railProcess: scene.railProcess?? null,
    time:0,
    energyMotion: scene.energyMotion ?? null,
    presentationSprings: scene.components.filter(c=>c.kind==='spring' && c.energyRelease),
    hybridProcess: scene.hybridProcess ?? null,
    hybridSprings: scene.components.filter(c=>c.kind==='spring'&&c.hybridSpring),
    gravity: scene.gravityEnabled===false ? 0 : Number(scene.gravity ?? 9.81)*pixelsPerMeter,
    //像素每米
    pixelsPerMeter,
    airDrag: Number(scene.airDrag ?? 0),
    collisionMode: scene.collisionMode ?? 'general',
    boundaryMode: scene.boundaryMode ?? 'open',

    contactMaterials: new Map((Array.isArray(scene.contactMaterials)?scene.contactMaterials:[]).map(item => [
      contactPairKey(item.leftId, item.rightId), { ...item },
    ])),
    collisionBindings,
    compounds:[],
    adhesionEvents:[],
    motionEvents: [],
    rehearsalStages: isRehearsalStageLaw(scene.rehearsalMotion?.law)
      ? scene.rehearsalMotion.actors.flatMap(actor => actor.stages.map(stage => ({
        id: `${actor.componentId}:${stage.id}`,
        bodyId: actor.componentId,
        stageId: stage.id,
        kind: `stage-${stage.endCondition}`,
        time: stage.end }))) : [],
    bodies,
    prescribedDuration: prescribedDurations.length ? Math.max(...prescribedDurations) : null,
    completed: false,
    supports,
    connections: (Array.isArray(scene.connections)?scene.connections:[]).map(item => ({
      ...item, left: { ...item.left }, right: { ...item.right },
    })),
    anchors: scene.components.filter(item=>item.role==='anchor').map(item => ({ ...item })),
    constraints: scene.components
      .filter(item => item.role==='constraint' && item.physicsEnabled!==false)
      .map(item =>({ ...item })),
    contacts:0,
    contactKeys: new Set(),
    impactKeys: new Set(),
    energy: 0,
    momentum: { x: 0, y: 0 },
    potentialReferenceY: Number(scene.potentialReferenceY ?? 824),
  };
  const bodiesById = new Map(world.bodies.map(body => [body.id, body]));
  //速度门初始约束
  for (const body of world.bodies) {
    const support=world.supports.find(s=>s.id===body.supportId);
    const constraint=trackRule(support);
    if(body.requiredTrackConstraint!=='bilateral'||constraint?.mode!=='bilateral-slot')
      continue;
    const angle=Math.atan2(body.y-support.cy,body.x-support.cx);
    const radius=guidedOrbitRadius(body,support,angle);
    const distance=Math.hypot(body.x-support.cx,body.y-support.cy);
    //math
    if(Math.abs(distance-radius)>1e-5)continue;
    const tangent=circleTangent(angle),speed=body.vx*tangent.x+body.vy*tangent.y;
    if(Math.abs(body.vx*Math.cos(angle)+body.vy*Math.sin(angle))>1e-5)continue;
    body.trackState={supportId:support.id,mode:'bilateral-slot',depthLayer:'track',entryPortalId:'initial',angle,tangentSpeed:speed,progressRadians:0,visitedCheckpointIds:[]};
  }
  for (const binding of world.collisionBindings.filter(item => item.kind==='rigid-from-start')) {
    stickPair(binding, bodiesById.get(binding.leftId), bodiesById.get(binding.rightId), world);
  }
  calculateMetrics(world, new Map(world.anchors.map(item => [item.id, item])), new Map(world.bodies.map(item => [item.id, item])))
  return world
}

// 外部原生实验步进器
//步数切(什么刀名)
export function tickWorld(world, dt = 1 / 120) {
  if(world.completed)return world;

  //本来想把底下这坨calculateMetrics抽出去的,但是不要高估自己的能力
  const sync=()=>calculateMetrics(
    world,
    new Map(world.anchors.map(c=>[c.id,c])),
    new Map(world.bodies.map(c=>[c.id,c]))
  );
  if(world.nativeExperiment?.family===inclinePlankPassageFamily){
    if(!Number.isFinite(dt)||dt<=0)return world;
    stepInclinePlank(world,dt);
    sync();
    return world;
  }
  if(world.nativeExperiment?.family===springShuttleFamily){
    if(!Number.isFinite(dt)||dt<=0)return world;
    stepSpringShuttle(world,dt);
    sync();
    return world;
  }
  if(constraintChangeFamilies.includes(world.nativeExperiment?.family)){
    if(!Number.isFinite(dt)||dt<=0)return world;
    const steps=Math.max(1,Math.ceil(dt/(1/480)));
    for(let i=0;i<steps&&!world.completed;i++)stepConstraintChange(world,dt/steps);
    sync();
    return world;
  }
  //循环
  const substeps = subSteps(world, dt);
  if (substeps === 1) return tickOnce(world, dt);
  const contactKeys = new Set();
  const impactKeys = new Set();
  const substep = dt / substeps;
  for (let index = 0; index < substeps; index +=1) {
   if(world.completed)break;
   tickOnce(world, substep);
   for (const key of world.contactKeys) contactKeys.add(key);
   for (const key of world.impactKeys) impactKeys.add(key);
  }
  world.contactKeys = contactKeys;
  world.impactKeys = impactKeys;
  world.contacts = contactKeys.size;
  return world;
}

//外力/积分/粘合/扫/解/撤力/判定
function tickOnce(world, dt) {
  world.contacts = 0;
  world.contactKeys.clear();
  world.impactKeys.clear();
  world.stepDt = dt;
  const anchors = new Map(world.anchors.map((item) => [item.id, item]));
  const bodies = new Map(world.bodies.map((item) => [item.id, item]));
  // 弹簧加速度[]
  const springAccelerations = new Map(world.bodies.map((body) => [
    body.id,
    springAcceleration(body, world.constraints, anchors, bodies),
  ]));

  const targetTime = world.prescribedDuration == null
    ? world.time + dt
    : Math.min(world.prescribedDuration, world.time + dt);

  // da圆弧复合体
  for (const compound of world.compounds) {
    if (compound.trackState) comboArc(compound, world, dt, bodies);
  }

  for (const body of world.bodies) {
    if (world.compounds.some(compound => compound.trackState && compound.memberIds.includes(body.id))) continue
    if (body.fixed === true) {
      body.previousX =body.x
      body.previousY =body.y
      body.vx = 0
      body.vy = 0
      continue
    }
    if (followProgram(body, world, targetTime)) continue
    if (body.trackState) {
      rideTrack(body, world, dt, anchors, bodies, springAccelerations.get(body.id))
      continue
    }
    updateTrackCooldown(body, dt)
    body.previousX = body.x
    body.previousY =body.y
    body.previousVx =body.vx
    body.previousVy =body.vy
    const springForce= springAccelerations.get(body.id) ?? { x: 0, y: 0 }
    const externalForce = forceAcceleration(body, world.pixelsPerMeter)
    const accelerationX = springForce.x + externalForce.x
    const accelerationY = world.gravity + springForce.y + externalForce.y
    body.vx += accelerationX* dt
    body.vy += accelerationY* dt
    const drag = dragMultiplier(world.airDrag, dt)
    body.vx*= drag
    body.vy*= drag
    //下面是个特判，用上一秒的角速度来计算常加速度
    const constantAccelerationStep = world.airDrag === 0
      && Math.abs(springForce.x)< EPSILON
      && Math.abs(springForce.y)< EPSILON
      && !body.supportId
      && !body.supportedBy
      && !body.attachedTo
    body.x += constantAccelerationStep
      ? body.previousVx * dt + 0.5 * accelerationX * dt * dt
      : body.vx * dt
    body.y += constantAccelerationStep
      ? body.previousVy * dt + 0.5 * accelerationY * dt * dt
      : body.vy * dt
    if (!world.compounds.some(compound => compound.memberIds.includes(body.id))) {
      tryCaptureGuidedTrack(body, world)
    }
  }

  //原来这里是一长串内联,抽成三个函数了,挤一下算了
  syncHyb(world,targetTime,bodies);
  syncBinds(world, bodies);
  sweptStick(world,dt, bodies);
  syncBinds(world, bodies);
  for (const compound of world.compounds) {
    if (!compound.trackState && !compound.memberIds.every(id=>isPrescribedMotion(bodies.get(id)?.motionProgram))) tryCaptureCompoundArc(compound, world, bodies);
  }

  contactRounds(world, bodies, anchors);

  //判定
  for (const body of world.bodies) {
    const stop = body.forceStop;
    if (!stop || !(Number(body.forceMagnitude) > 0)) continue;
    //支撑面上面
    body.forceOrigin ??= { x: body.x, y: body.y };
    body.forceTravelled = Math.hypot(body.x - body.forceOrigin.x, body.y - body.forceOrigin.y) / world.pixelsPerMeter;
    if ((Number(stop.afterDistance) > 0 && body.forceTravelled >= Number(stop.afterDistance))
      || (Number(stop.afterTime) >0 && targetTime >=Number(stop.afterTime))) {
      body.forceMagnitude = 0;
      world.motionEvents?.push?.({ kind: 'forceRemoved', bodyId: body.id,time:targetTime});
    }
  }
  world.time = targetTime;
  world.completed = world.prescribedDuration != null && world.time >= world.prescribedDuration - EPSILON;

  const experiment=world.nativeExperiment;
  if(experiment){
    const body=bodies.get(experiment.bodyId);
    const reached=experiment.family==='threaded-circle'
      ? body?.trackState?.angle>=experiment.terminalAngle
      : experiment.family==='horizontal-rope-pull'?world.time>=experiment.duration-1e-9
      : experiment.family==='horizontal-conveyor'&&Math.abs(body?.vx-experiment.beltSpeed)<1e-5;
    if(reached){
      if(Number.isFinite(body.trackState?.terminalStepDuration))world.time=targetTime-dt+body.trackState.terminalStepDuration;
      world.completed=true;world.motionEvents.push({kind:experiment.family==='threaded-circle'?'guide-bottom':experiment.family==='horizontal-rope-pull'?'observation-end':'belt-co-speed',bodyId:body.id,time:world.time});
    }
  }
  world.contacts = world.contactKeys.size;
  calculateMetrics(world, anchors, bodies);
  return world;
}

// 扫掠粘合,stick-on-contact且两边都是质点的时候run
function sweptStick(world, dt, bodies) {
  //理想点会跑的很快，一个子步能run过整段接触皮
  //要先解掉扫掠撞上的第一下，不然题目loop的碰撞会直接漏过去
  for (const binding of world.collisionBindings) {
    if (binding.active || binding.kind !== 'stick-on-contact') continue;
    const a = bodies.get(binding.leftId), b = bodies.get(binding.rightId);
    if (a?.physicsGeometry !== 'point'||b?.physicsGeometry !== 'point') continue;
    const startX = b.previousX-a.previousX;
    const startY = b.previousY-a.previousY;
    const endX = b.x - a.x, endY = b.y - a.y;
    const dx = endX - startX, dy = endY - startY;
    //一元二次相对位移，取第一个正根
    const aa=dx*dx + dy * dy, bb = 2 * (startX * dx + startY * dy);
    const cc = startX * startX + startY * startY - 4;
    const discriminant = bb * bb - 4 * aa * cc;
    // if (discriminant === 0) {
    //   if (bb >= 0) continue;
    //   const fraction = -bb / (2 * aa);
    //   if (fraction < 0 || fraction > 1) continue;
    //   for (const body of [a, b]) {body.x=body.previousX + (body.x-body.previousX) *fraction;
    //     body.y=body.previousY + (body.y-body.previousY) *fraction
    //   }
    // }
    if (![aa, bb, cc, discriminant].every(Number.isFinite) || aa <= EPSILON || cc <= 0 || bb >= 0 || discriminant < 0) continue;
    const fraction = (-bb - Math.sqrt(discriminant)) / (2 * aa);
    if (fraction < 0 || fraction > 1) continue;
    for (const body of [a, b]) {
      body.x = body.previousX + (body.x - body.previousX) * fraction;
      body.y = body.previousY + (body.y - body.previousY) * fraction;
    }
    const nx = (b.x - a.x) / 2, ny = (b.y - a.y) / 2;
    applyPairImpulse(a, b, nx, ny, 0, world);
    registerContact(world, a.id, b.id);
    const remaining = dt * (1 - fraction);
    for (const body of [a, b]) { body.x += body.vx * remaining; body.y += body.vy * remaining; }
  }
}

// 这部分是接触求解,多轮迭代是因为一轮解完会顶出新的穿透，然后再几轮之后基本收敛
function contactRounds(world, bodies, anchors) {
  //TODO: 4轮是不是多了,可以改改，不过3轮确定是能过的
  for (let iteration = 0; iteration < 4; iteration += 1) {
    for (const compound of world.compounds) {
      if (compound.memberIds.every(id=>isPrescribedMotion(bodies.get(id)?.motionProgram))) continue
      if (compound.trackState) continue
      // resolveCompoundArc(compound,world,bodies)
      for (const support of world.supports) {
        if (support.kind !== 'arc') resolveCompoundSegment(compound, support, world, bodies)
      }
    }
    // 第二轮，单体对支撑面
    for (const body of world.bodies) {
      const compound = world.compounds.find(item => item.memberIds.includes(body.id))
      if (compound?.trackState) {
        registerContact(world, body.id, compound.trackState.supportId)
        continue
      }
      if (compound) continue
      if (isPrescribedMotion(body.motionProgram)) continue
      if (body.trackState) {
        registerContact(world, body.id, body.trackState.supportId)
        continue
      }
      for (const support of world.supports) {
        if (support.kind === 'arc') {
          if (!compound) resolveArc(body, support, world)
        }
        else resolveSegment(body, support, world)
      }
      if (world.boundaryMode === 'bounce') resolveBounds(body, world)
    }

    // 物体不多，两两检查，n^2复杂度，应该不至于上网格
    for (let left = 0; left < world.bodies.length; left += 1) {
      for (let right = left + 1; right < world.bodies.length; right += 1) {
        if (isPrescribedMotion(world.bodies[left].motionProgram)
          || isPrescribedMotion(world.bodies[right].motionProgram)) continue
        if (!sharesCollisionLayer(world.bodies[left], world.bodies[right])) continue
        if (!sameCompound(world, world.bodies[left].id, world.bodies[right].id)) {
          resolveBodyPair(world.bodies[left], world.bodies[right], world)
        }
      }
    }

    solveRopes(world, anchors, bodies)
    syncBinds(world, bodies)
  }
}

// 内部子步数，最远位移to最小尺寸，取两者的较大值
function subSteps(world, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return 1;
  let max_travel = 0;
  let min_extent = Infinity;
  // 先估做个预处理
  for (const body of world.bodies) {
    if (body.fixed === true || isPrescribedMotion(body.motionProgram)) continue;
    const speed = Math.hypot(Number(body.vx ?? 0), Number(body.vy ?? 0));
    max_travel = Math.max(max_travel, speed * dt + Math.abs(world.gravity) * dt * dt);
    const extent = body.physicsGeometry === 'point' ? 1 : body.kind === 'ball'
      ? Number(body.radius)
      : Math.min(Number(body.width ?? Infinity), Number(body.height ?? Infinity)) / 2;
    if (Number.isFinite(extent) && extent > 0) min_extent = Math.min(min_extent, extent);
  }
  //高中公式ω·dt=√(k/m)
  //a body oscillates at ω = √(k/m) one coarse
  //step per frame loses a visible share of a launcher's energy (a 50 J launcher
  //gave 9.6 m/s instead of 10). Keep ω·dt small while such a spring acts as a
  const springSteps = stiffSpringSubsteps(world, dt);
  if (!Number.isFinite(min_extent) || max_travel <= 0) return Math.max(1, Math.min(MAX_INTERNAL_SUBSTEPS, springSteps));
  //Relative motion may be twice one body's travel. Keeping each internal move below
  //roughly half the smallest radius/half-size makes an overlap observable before two
  //bodies or a body and a thin support can exchange sides
  //相对运动能到单体位移的两倍
  const safeTravel = Math.max(0.5, min_extent * 0.4);
  return Math.max(1, springSteps, Math.min(MAX_INTERNAL_SUBSTEPS, Math.ceil(max_travel / safeTravel)));
}

const SPRING_PHASE_PER_STEP = 0.05; //ω·dt
// 硬簧单独算
function stiffSpringSubsteps(world, dt) {
  const springs = (world.constraints ?? []).filter(item => item.kind === 'spring' && item.physicsEnabled !== false && Number(item.stiffness) > 0);
  if (!springs.length) return 1;
  const anchors = new Map((world.anchors ?? []).map(item => [item.id, item]));
  const bodies = new Map((world.bodies ?? []).map(item => [item.id, item]));
  let steps = 1;
  for (const constraint of springs) {
    const { start, end, startMode, endMode } = springNow(constraint, anchors, bodies);
    if (![start.x, start.y, end.x, end.y].some(v => !Number.isFinite(v))) continue;
    const stretch = Math.hypot(end.x - start.x, end.y - start.y) - Number(constraint.length ?? 0);
    //接触簧只在被压着的时候起作用
    if ((startMode === 'contact' || endMode === 'contact') && stretch >= 0) continue;
    for (const body of [start.body, end.body]) {
      if (!body || body.fixed === true) continue;
      const omega = Math.sqrt(Number(constraint.stiffness) / Math.max(1e-6, bodyMass(body)));
      steps = Math.max(steps, Math.ceil(omega * dt / SPRING_PHASE_PER_STEP));
    }
  }
  return steps;
}

//气阻按每秒保留率折算
//如果是1-airDrag的话60Hz和120Hz会完全不同
function dragMultiplier(airDrag, dt) {
  const perFrameRetention = Math.max(0, 1 - Math.max(0, Number(airDrag ?? 0)));
  return perFrameRetention**(Math.max(0, Number(dt ?? 0)) * 60);
}

//位置速度-》状态函数
// 事件临界（到某点、撤力）补进motionEvents
function followProgram(body, world, time) {
  const program = body.motionProgram;
  if (!isPrescribedMotion(program)) return false;
  const duration = Math.max(0, Number(program.duration ?? 0));
  const localTime = Math.max(0, Math.min(duration, Number(time ?? 0)));
  if(program.kind==='critical-loop-passage'){
    const state=criticalLoopStateAt(program.model,localTime);
    body.previousX=body.x;body.previousY=body.y;
    body.x=program.originX+state.position*world.pixelsPerMeter;
    body.y=program.originY+state.verticalPosition*world.pixelsPerMeter;
    body.vx=state.velocity*world.pixelsPerMeter;
    body.vy=state.verticalVelocity*world.pixelsPerMeter;

    const entrance=program.model.stages[0].end,top=program.model.duration;
    for(const event of [{kind:'enter-guided-loop',time:entrance},{kind:'reach-loop-top',time:top}])
      if(event.time>world.time&&event.time<=localTime+1e-12
        &&!world.motionEvents.some(e=>e.bodyId===body.id&&e.kind===event.kind&&e.time===event.time))
        world.motionEvents.push({...event,bodyId:body.id});
    return true;
  }
  // if(program.kind==='loop-carrier-passage'){ }
  if(program.kind==='loop-carrier-composition'){
    const state=loopCarrierStateAt(program.model,localTime,program.role);
    body.previousX=body.x;body.previousY=body.y;
    body.x=program.originX+state.position*world.pixelsPerMeter;
    body.y=program.originY+state.verticalPosition*world.pixelsPerMeter;
    body.vx=state.velocity*world.pixelsPerMeter;body.vy=state.verticalVelocity*world.pixelsPerMeter;

    const entry=program.model.stages.find(s=>s.kind==='carrier-entry');
    const events=[...program.model.stages.slice(0,-1).map(s=>({kind:`${s.kind}-exit`,time:s.end})),
      ...program.model.carrier.events.map(e=>({...e,time:e.time+entry.start}))];
    for(const event of events)if(program.role===(event.kind==='board-wall'?'board':'block')&&event.time>world.time&&event.time<=localTime+1e-12
      &&!world.motionEvents.some(e=>e.kind===event.kind&&e.time===event.time))world.motionEvents.push({...event,bodyId:body.id});
    return true;
  }
  if(program.kind==='hybrid-process'){
    const state=hybridStateAt(program.model,localTime)[program.role];
    body.previousX=body.x;body.previousY=body.y;
    body.x=program.originX+program.axisX*state.position*world.pixelsPerMeter;
    body.y=program.originY+program.axisY*state.position*world.pixelsPerMeter;
    body.vx=program.axisX*state.velocity*world.pixelsPerMeter;body.vy=program.axisY*state.velocity*world.pixelsPerMeter;
    const activePhase=program.model.phases.find(p=>localTime<p.end-1e-12)??program.model.phases.at(-1);
    const activeLaw=program.model.definition.stages.find(s=>s.id===activePhase.id).laws[program.role];
    // constantForce 是解出来的轴向合力，上报外力的重力表现出来的那部分投影已经扣掉了
    // 不然竖直自由落体会算两遍重力
    const appliedForce=activeLaw.kind==='constantForce'
      ?activeLaw.force-body.mass*(world.gravity/world.pixelsPerMeter)*program.axisY
      :activeLaw.kind==='friction'?activeLaw.force??0:0;
    body.forceMagnitude=Math.abs(appliedForce);
    body.forceAngle=(Math.atan2(-program.axisY,program.axisX)*180/Math.PI+(appliedForce<0?180:0)+360)%360;
    for(const phase of program.model.phases)if(phase.end>world.time&&phase.end<=localTime+1e-12){
      const definition=program.model.definition.stages.find(s=>s.id===phase.id);
      for(const id of phase.eventsAtEnd){
        const e=definition.events.find(e=>e.id===id);
        if(!world.motionEvents.some(r=>r.id===id&&r.time===phase.end))world.motionEvents.push({id,kind:e.kind,time:phase.end});
      }
    }
    return true;
  }
  if(program.kind==='carrier-entry-stage'){
    const state=carrierEntryStateAt(program.model,localTime,program.role);
    body.previousX=body.x;body.previousY=body.y;
    body.x=program.originX+state.position*world.pixelsPerMeter;body.y=program.originY;
    body.vx=state.velocity*world.pixelsPerMeter;body.vy=0;
    for(const event of program.model.events)if(event.time>world.time&&event.time<=localTime+1e-12
      &&!world.motionEvents.some(e=>e.kind===event.kind&&e.time===event.time))world.motionEvents.push({...event,bodyId:body.id});
    return true;
  }
  if(program.kind==='finite-rail-chain'){
    const state=finiteRailChainStateAt(program.model,localTime);
    const previous={...body};
    body.previousX=body.x;body.previousY=body.y;
    body.x=program.originX+state.x*world.pixelsPerMeter;body.y=program.originY+state.y*world.pixelsPerMeter;
    body.vx=state.vx*world.pixelsPerMeter;body.vy=state.vy*world.pixelsPerMeter;body.angle=state.angle;
    let startX=program.originX,startY=program.originY;
    const observations=[];
    for(const event of program.model.events){
      const segment=program.model.parameters.segments[event.segment];
      const endX=startX+segment.axisX*segment.length*world.pixelsPerMeter;
      const endY=startY+segment.axisY*segment.length*world.pixelsPerMeter;
      const supportId=world.railProcess?.bindings?.supportIds?.[event.segment];
      const support=world.supports.find(s=>s.id===supportId);
      if(support)observations.push({id:`${event.kind}-${event.segment}`,kind:event.kind,
        bodyId:body.id,markerId:support.id,feature:'reference',direction:1,
        path:{start:{x:startX,y:startY},end:{x:endX,y:endY}},marker:{x:endX,y:endY},
        expectedTime:event.time});
      startX=endX;startY=endY;
    }
    for(const hit of localTime>world.time?observePathCrossings({[body.id]:previous},{[body.id]:body},
      observations,world.motionEvents,world.time,localTime):[]){
      const event=program.model.events.find(e=>`${e.kind}-${e.segment}`===hit.id);
      hit.segment=event.segment;hit.speed=event.speed;
    }
    return true;
  }
  if(program.kind==='school-process'){
    const state=schoolProcessStateAt(program.model,localTime,program.processRole);
    body.previousX=body.x;body.previousY=body.y;
    body.x=program.originX+state.position*world.pixelsPerMeter;body.y=program.originY+(state.verticalPosition??0)*world.pixelsPerMeter;
    body.vx=state.velocity*world.pixelsPerMeter;body.vy=(state.verticalVelocity??0)*world.pixelsPerMeter;
    if(program.model.family==='ramped-force-carrier'&&program.processRole==='block')body.forceMagnitude=program.model.parameters.forceRate*localTime;
    return true;
  }

  // 竖直弹跳计算地面冲击
  if (program.kind==='vertical-bounce') {
    const state = verticalBounceStateAt(program, localTime);//接触count
    body.previousX = body.x; body.previousY = body.y;
    body.x=program.originX + state.x*world.pixelsPerMeter;
    body.y=program.originY + state.y*world.pixelsPerMeter;
    body.vx = state.velocityX*world.pixelsPerMeter;
    body.vy = state.velocityY*world.pixelsPerMeter;
    body.forceMagnitude = state.appliedForceY; body.forceAngle = 90;

    for (const event of program.events) 
    if(event.time>world.time && event.time<=localTime+1e-12
      && !world.motionEvents.some(recorded => recorded.bodyId===body.id
      && recorded.kind===event.kind && recorded.time===event.time))
    {
      world.motionEvents.push({ ...event, bodyId: body.id });
      if (event.kind==='ground-impact') {
        const key = `motion:${body.id}:ground-impact`;
        world.impactKeys.add(key); world.contactKeys.add(key); world.contacts++;
      }
    }
    return true;
  }
  if (program.kind==='constant-acceleration-2d') {
    const x0 = Number(program.initialX ?? 0)
    const y0 = Number(program.initialY ?? 0)
    const v0x = Number(program.initialVelocityX ?? 0)
    const v0y = Number(program.initialVelocityY ?? 0)
    const ax = Number(program.accelerationX ?? 0)
    const ay = Number(program.accelerationY ?? 0)
    body.previousX = body.x
    body.previousY = body.y
    body.x = Number(program.originX ?? body.x) + (x0 + v0x*localTime + 0.5*ax*localTime*localTime) * world.pixelsPerMeter
    body.y = Number(program.originY ?? body.y) + (y0 + v0y*localTime + 0.5*ay*localTime*localTime) * world.pixelsPerMeter
    body.vx = (v0x + ax*localTime) * world.pixelsPerMeter
    body.vy = (v0y + ay*localTime) * world.pixelsPerMeter
    if (Math.hypot(v0x+ax*localTime, v0y+ay*localTime) > EPSILON) body.angle = Math.atan2(v0y+ay*localTime, v0x+ax*localTime)
    return true
  }
  if (program.kind==='uniform-circular') {
    const r = Number(program.radius ?? 0)
    const w = Number(program.angularVelocity ?? 0)//角速度
    const angle = Number(program.initialAngle ?? 0) + w*localTime
    body.previousX = body.x
    body.previousY = body.y
    body.x = Number(program.centerX ?? body.x) + r*Math.cos(angle)*world.pixelsPerMeter
    body.y = Number(program.centerY ?? body.y) + r*Math.sin(angle)*world.pixelsPerMeter
    body.vx = -r*w*Math.sin(angle)*world.pixelsPerMeter
    body.vy = r*w*Math.cos(angle)*world.pixelsPerMeter
    body.angle = angle + (w>=0 ? Math.PI/2 : -Math.PI/2)
    return true
  }
  // 剩下几种都是沿一条轴平动,几乎一样，就是加速度来源不一样
  const initialPosition = Number(program.initialPosition ?? 0)
  const initialVelocity = Number(program.initialVelocity ?? 0)
  let acceleration = Number(program.acceleration ?? 0)
  let position = initialPosition
  let velocity = initialVelocity
  if (program.kind === 'energy-linear') {
    ({position, velocity} = energyStagesOf(program,localTime))
  } else if (program.kind === 'piecewise-linear') {
    let remaining = localTime
    for (const segment of program.segments ?? []) {
      const seg_duration = Math.max(0, Number(segment.duration ?? 0))
      acceleration = Number(segment.acceleration ?? 0)
      const step = Math.min(remaining, seg_duration)
      position += velocity*step + 0.5*acceleration*step*step
      velocity += acceleration*step
      remaining -= step
      if (remaining <= EPSILON) break
    }
  } else {
    position = initialPosition + initialVelocity*localTime + 0.5*acceleration*localTime*localTime
    velocity = initialVelocity + acceleration*localTime
  }
  const axisLength = Math.hypot(Number(program.axisX ?? 1), Number(program.axisY ?? 0)) || 1
  const axisX = Number(program.axisX ?? 1)/axisLength
  const axisY = Number(program.axisY ?? 0)/axisLength
  body.previousX = body.x
  body.previousY = body.y
  body.x = Number(program.originX ?? body.x) + axisX*position*world.pixelsPerMeter
  body.y = Number(program.originY ?? body.y) + axisY*position*world.pixelsPerMeter
  body.vx = axisX*velocity*world.pixelsPerMeter
  body.vy = axisY*velocity*world.pixelsPerMeter
  for (const event of world.rehearsalStages ?? []) {
    if (event.bodyId === body.id && localTime >= event.time - EPSILON
      && !world.motionEvents.some(recorded => recorded.id === event.id)) world.motionEvents.push({ ...event })
  }
  //平动程序今后不要介入角度！！！
  if (!(world.rehearsalStages ?? []).some(stage => stage.bodyId === body.id))
    body.angle = Math.atan2(axisY, axisX)
  return true
}

// 判断是不是题给运动
function isPrescribedMotion(program) {
  //这堆全是题目直接把运动给出来的，位置速度照公式走
  const kinds = ['critical-loop-passage', 'loop-carrier-composition', 'hybrid-process',
    'carrier-entry-stage', 'finite-rail-chain', 'school-process', 'vertical-bounce',
    'energy-linear', 'uniform-linear', 'piecewise-linear', 'constant-acceleration-2d', 'uniform-circular']
  return kinds.includes(program?.kind)
}

//展示用
function syncHyb(world,time,bodies){
 const p=world.hybridProcess;if(!p)return;
 const phase=[...p.model.phases].reverse().find(s=>s.end<=time+1e-12);
 const groups=phase?.groupsAfter??[];
// syncHyb(world,time,bodies);
// world.tracks=groups.map(group=>{ 
// });
 world.compounds=groups.map(group=>{
  const members=group.map(role=>bodies.get(p.bindings.bodies[role])),memberIds=members.map(b=>b.id);
  const mass=members.reduce((n,b)=>n+b.mass,0),weighted=k=>members.reduce((n,b)=>n+b.mass*b[k],0)/mass;
  const x=weighted('x'),y=weighted('y'),vx=weighted('vx'),vy=weighted('vy');
  const formed=p.model.phases.find(s=>s.groupsAfter.some(g=>g.length===group.length&&g.every(id=>group.includes(id))));
  return {id:memberIds.slice().sort().join('|'),memberIds,mass,x,y,vx,vy,angle:0,
   formedAt:formed.end,originX:x,originY:y,formationKind:'collision-adhesion',trackState:null,
   offsets:Object.fromEntries(members.map(b=>[b.id,{x:b.x-x,y:b.y-y}]))};
 });
}

//冷却计时器
function updateTrackCooldown(body, dt) {
  //body脱离导轨后一小段时间内不会被同一根吸回去
  if (!body.trackCooldown) return;
  body.trackCooldown.remaining -= dt;
  if (body.trackCooldown.remaining <= 0) body.trackCooldown = null;
}

// 圆的切向，正方向逆时针
function circleTangent(angle) { return { x: -Math.sin(angle), y: Math.cos(angle) } }
function trackDir(value, fallback) { // 方向字段常常是空的，拿速度符号兜一下
  const number = Number(value)
  if (number === 1 || number === -1) return number
  return Math.sign(Number(fallback)) || 1
}

// 碰到入口就吸上去
function tryCaptureGuidedTrack(body, world) {
  if (body.trackState) return
  for (const support of world.supports) {
    const constraint = trackRule(support)
    if (!constraint || body.trackCooldown?.supportId === support.id) continue
    for (const portal of constraint.entryPortals) {
      const angle = normalizedAngle(Number(portal.angle))
      const target = guidedBodyPoint(body, support, angle)
      const captureRadius = Math.max(6, Number(portal.captureRadius ?? 12))
      const distance = distSeg(
        target.x,
        target.y,
        Number(body.previousX ?? body.x),
        Number(body.previousY ?? body.y),
        body.x,
        body.y,
      )
      if (distance > captureRadius) continue
      if (!guidedPortalMotion(body, portal, angle).aligned) continue;
      // body会在捕获挪到入口上
      // placeGuidedBody(body, support, angle, 0)
      {
        const push = Number(body.forceMagnitude) > 0 ? forceAcceleration(body, world.pixelsPerMeter) : { x: 0, y: 0 };
        const ax = push.x, ay = push.y + Number(world.gravity ?? 0);
        const speed = Math.hypot(body.vx, body.vy);
        const squared = speed * speed + 2 * (ax * (target.x - body.x) + ay * (target.y - body.y));
        if (speed > EPSILON && squared > 0) { const scale = Math.sqrt(squared) / speed; body.vx *= scale; body.vy *= scale; }
      }
      const motion = guidedPortalMotion(body, portal, angle)
      body.trackState = {
        supportId: support.id,
        mode: constraint.mode,
        depthLayer: 'track',
        entryPortalId: String(portal.id ?? 'entry'),
        angle,
        tangentSpeed: motion.tangentSpeed,
        progressRadians: 0,
        visitedCheckpointIds: [],
      }
      body.lastTrackExit = null
      placeGuidedBody(body, support, angle, motion.tangentSpeed)
      registerContact(world, body.id, support.id)
      return
    }
  }
}

//check切向速度和是否对齐
function guidedPortalMotion(body, portal, angle) {
  const positiveTangent = circleTangent(angle)
  const tangentSpeed = body.vx * positiveTangent.x + body.vy * positiveTangent.y
  const speed = Math.hypot(body.vx, body.vy)
  const minimumAlignment = clamp(Number(portal.minTangentAlignment ?? 0.75), 0, 1)
  const direction = trackDir(portal.direction, tangentSpeed)
  return {
    positiveTangent,
    tangentSpeed,
    direction,
    aligned: speed >= EPSILON
      && Math.abs(tangentSpeed) / speed >= minimumAlignment
      && Math.sign(tangentSpeed) === direction,
  }
}

//给刚进入的item做个预判
function headingPortal(body, support) {
  if (body.trackState || body.trackCooldown?.supportId === support.id) return false;
  const constraint = trackRule(support);
  if (!constraint) return false;
  for (const portal of constraint.entryPortals) {
    const angle = normalizedAngle(Number(portal.angle));
    const motion = guidedPortalMotion(body, portal, angle);
    if (!motion.aligned) continue;
    const target = guidedBodyPoint(body, support, angle);
    const travelTangent = {
      x: motion.positiveTangent.x * motion.direction,
      y: motion.positiveTangent.y * motion.direction,
    };
    const radial = { x: Math.cos(angle), y: Math.sin(angle) };
    const deltaX = body.x - target.x;
    const deltaY = body.y - target.y;
    const along = deltaX * travelTangent.x + deltaY * travelTangent.y;
    const normalDistance = Math.abs(deltaX * radial.x + deltaY * radial.y);
    const captureRadius = Math.max(6, Number(portal.captureRadius ?? 12));
    const tangentialRadius = supportRadius(body, travelTangent.x, travelTangent.y);
    const approachLength = Math.min(
      Math.max(1, Number(support.radius)),
      Math.max(48, tangentialRadius * 6),
    );

    if (along >= -approachLength && along <= 0 && normalDistance <= captureRadius) return true;
  }
  return false;
}

//angle/弧度，speed/切向速度
function guideRK4(angle0,speed0,h,orbitRadius,acc){
  const derivative=(angle,speed)=>({a:speed/orbitRadius,v:-acc.x*Math.sin(angle)+acc.y*Math.cos(angle)});
  const a=derivative(angle0,speed0),b=derivative(angle0+a.a*h/2,speed0+a.v*h/2);
  const c=derivative(angle0+b.a*h/2,speed0+b.v*h/2),d=derivative(angle0+c.a*h,speed0+c.v*h);
  return {angle:angle0+h*(a.a+2*b.a+2*c.a+d.a)/6,speed:speed0+h*(a.v+2*b.v+2*c.v+d.v)/6};
}

//二分
function bisectRange(lo,hi,test,rounds){
  for(let i=0;i<rounds;i++){const mid=(lo+hi)/2;if(test(mid))hi=mid;else lo=mid}
  return [lo,hi]
}

//纯恒力走RK4/
//有摩擦或弹簧ze退回显式步进
function rideTrack(body, world, dt, anchors, bodies, cachedSpringForce = null) {
  const state = body.trackState;
  const support = world.supports.find((item) => item.id === state.supportId);
  const constraint = trackRule(support);
  if (!support || !constraint) {
    body.trackState = null;
    return;
  }

  const previousAngle = state.angle;
  const positiveTangent = circleTangent(previousAngle);
  const radial = { x: Math.cos(previousAngle), y: Math.sin(previousAngle) };
  const springForce = cachedSpringForce ?? springAcceleration(body, world.constraints, anchors, bodies);
  const externalForce = forceAcceleration(body, world.pixelsPerMeter);
  const externalAcceleration = {
    x: springForce.x + externalForce.x,
    y: world.gravity + springForce.y + externalForce.y,
  };
  //轨道半径跟物体朝向有关
  const orbitRadius = guidedOrbitRadius(body, support, previousAngle);
  const externalRadial = externalAcceleration.x * radial.x + externalAcceleration.y * radial.y;
  const constraintAcceleration = -(state.tangentSpeed ** 2) / orbitRadius - externalRadial;
  const oneSided = constraint.mode === 'unilateral-track';
  const normalAcceleration = support.contactSide === 'outer'
    ? constraintAcceleration
    : -constraintAcceleration;
  //恰好通过最高点情况特判，这tm第几回特判了
  const grazing = Math.abs(world.gravity)*1e-4;
  if (oneSided && normalAcceleration < -Math.max(EPSILON, grazing)) {
    releaseGuidedBody(body, support, state, {
      id: 'contact-loss', angle: previousAngle, direction: Math.sign(state.tangentSpeed || 1),
    });
    return;
  }
  // 圆周运动的题判松一点】
  const previousSpeed = state.tangentSpeed;
  const frictionAcceleration = contactFriction(world, body, support) * Math.abs(constraintAcceleration);//等效切向阻力
  const trackResistance = Math.max(0, Number(support.trackResistance ?? 0));
  const resistanceAcceleration = trackResistance > 0
    ? trackResistance / bodyMass(body) * Number(world.pixelsPerMeter ?? PIXELS_PER_METER) : 0;
  if(frictionAcceleration===0&&resistanceAcceleration===0&&world.airDrag===0&&springForce.x===0&&springForce.y===0){
    //恒力和重力积分
    const integrate=(h)=>guideRK4(previousAngle,previousSpeed,h,orbitRadius,externalAcceleration);
    let next=integrate(dt);
    if(oneSided){
      //法向力
      const normalAt=({angle,speed})=>{
        const radialAcceleration=externalAcceleration.x*Math.cos(angle)+externalAcceleration.y*Math.sin(angle);
        const constraintNext=-(speed**2)/orbitRadius-radialAcceleration;
        return support.contactSide==='outer'?constraintNext:-constraintNext;
      };
      if(normalAt(next)<-Math.max(EPSILON,grazing)){
        const release_t=bisectRange(0,dt,mid=>normalAt(integrate(mid))<0,30)[0];
        const release=integrate(release_t);
        state.tangentSpeed=release.speed;state.progressRadians+=Math.abs(release.angle-previousAngle);
        markGates(state,constraint.checkpoints,previousAngle,release.angle);
        releaseGuidedBody(body,support,state,{id:'contact-loss',angle:release.angle,direction:Math.sign(release.speed||1)});
        return;
      }
    }
    const experiment=world.nativeExperiment;
    if(experiment?.family==='threaded-circle'&&experiment.bodyId===body.id
      &&previousAngle<experiment.terminalAngle&&next.angle>=experiment.terminalAngle){
      const [,hi]=bisectRange(0,dt,mid=>integrate(mid).angle>=experiment.terminalAngle,36);
      next=integrate(hi);next.angle=experiment.terminalAngle;state.terminalStepDuration=hi;
    }
    state.angle=next.angle;state.tangentSpeed=next.speed;state.progressRadians+=Math.abs(next.angle-previousAngle);
    placeGuidedBody(body,support,next.angle,next.speed,world);
    markGates(state,constraint.checkpoints,previousAngle,next.angle);
    const exit=constraint.exitPortals.find(portal=>canExitGuidedTrack(state,portal,previousAngle,next.angle));
    if(exit)releaseGuidedBody(body,support,state,exit);
    return;
  }
  //有摩擦或弹簧退回显式步进
  const tangentAcceleration = externalAcceleration.x*positiveTangent.x + externalAcceleration.y*positiveTangent.y
  const drivenSpeed = state.tangentSpeed + tangentAcceleration * dt
  const frictionDelta = (frictionAcceleration + resistanceAcceleration) * dt
  state.tangentSpeed = Math.abs(drivenSpeed) <= frictionDelta
    ? 0
    : drivenSpeed - Math.sign(drivenSpeed) * frictionDelta
  const drag = dragMultiplier(world.airDrag, dt)
  state.tangentSpeed *= drag
  const nextAngle = previousAngle + state.tangentSpeed / orbitRadius * dt
  const deltaAngle = nextAngle - previousAngle
  // placeGuidedBody(body, support, nextAngle, state.tangentSpeed, world)
  if (oneSided && Math.abs(deltaAngle) > EPSILON) {
    const nextRadial = { x: Math.cos(nextAngle), y: Math.sin(nextAngle) }
    const nextExternalRadial = externalAcceleration.x*nextRadial.x + externalAcceleration.y*nextRadial.y
    const nextConstraintAcceleration = -(state.tangentSpeed ** 2) / orbitRadius - nextExternalRadial
    const nextNormalAcceleration = support.contactSide === 'outer'
      ? nextConstraintAcceleration
      : -nextConstraintAcceleration
    if (nextNormalAcceleration < 0) {
      const release_frac = clamp(normalAcceleration / Math.max(EPSILON, normalAcceleration - nextNormalAcceleration), 0, 1)
      const releaseAngle = previousAngle + deltaAngle * release_frac
      state.tangentSpeed = previousSpeed + (state.tangentSpeed - previousSpeed) * release_frac
      state.angle = releaseAngle
      state.progressRadians += Math.abs(releaseAngle - previousAngle)
      markGates(state, constraint.checkpoints, previousAngle, releaseAngle)
      releaseGuidedBody(body, support, state, {
        id: 'contact-loss', angle: releaseAngle, direction: Math.sign(deltaAngle),
      })
      return
    }
  }
  state.angle = nextAngle
  state.progressRadians += Math.abs(deltaAngle)
  placeGuidedBody(body, support, nextAngle, state.tangentSpeed)
  markGates(state, constraint.checkpoints, previousAngle, nextAngle)

  const exit = constraint.exitPortals.find((portal) => canExitGuidedTrack(state, portal, previousAngle, nextAngle))
  if (exit) releaseGuidedBody(body, support, state, exit)
}

//脱离导轨
function releaseGuidedBody(body, support, state, portal) {
  const angle = normalizedAngle(Number(portal.angle));
  const tangent = circleTangent(angle);
  const tangentSpeed = state.tangentSpeed;
  placeGuidedBody(body, support, angle, tangentSpeed);
  body.vx = tangent.x * tangentSpeed;
  body.vy = tangent.y * tangentSpeed;
  body.lastTrackExit = {
    supportId: support.id,
    portalId: String(portal.id ?? 'exit'),
    progressRadians: state.progressRadians,
  };
  body.trackState = null;
  body.trackCooldown = { supportId: support.id, remaining: Math.max(0.05, Number(portal.cooldownSeconds ?? 0.12)) };
}

function markGates(state, checkpoints, previousAngle, nextAngle) { // 过检查点记一笔，题目要问"经过A点时的速度"就靠这个
  for (const checkpoint of checkpoints) {
    const id = String(checkpoint.id ?? 'checkpoint');
    if (state.visitedCheckpointIds.includes(id)) continue;
    if (passedAngle(previousAngle, nextAngle, Number(checkpoint.angle))) {
      state.visitedCheckpointIds.push(id);
    }
  }
}

// 出口判定
function canExitGuidedTrack(state, portal, previousAngle, nextAngle) {
  if (Math.abs(nextAngle - previousAngle) < EPSILON) return false;
  const direction = Math.sign(nextAngle - previousAngle);
  if (portal.direction != null && trackDir(portal.direction, direction) !== direction) return false;
  const minimumProgress = Math.max(
    0,
    Number(portal.minProgressRadians ?? 0),
    Number(portal.minTurns ?? 0) * Math.PI * 2,
  );
  if (state.progressRadians + 1e-6 < minimumProgress) return false;
  return passedAngle(previousAngle, nextAngle, Number(portal.angle));
}

// 导轨约束的合法性检查
function trackRule(support) {
  const value = support?.trackConstraint;
  if (support?.fullCircle !== true && value?.span !== 'open') return null;
  if (!value || value.kind !== 'guided-path' || !['bilateral-slot', 'unilateral-track'].includes(value.mode)) return null;
  if (!Array.isArray(value.entryPortals) || !Array.isArray(value.exitPortals)) return null;
  return {
    ...value,
    checkpoints: Array.isArray(value.checkpoints) ? value.checkpoints : [],
  };
}

// 圆上一点,注意半径是轨道半径，不是radius
function guidedBodyPoint(body, support, angle) {
  const radius = guidedOrbitRadius(body, support, angle);
  return {
    x: Number(support.cx) + Math.cos(angle) * radius,
    y: Number(support.cy) + Math.sin(angle) * radius,
  };
}

// 槽式导轨
function guidedOrbitRadius(body, support, angle) {
  if(support.trackConstraint?.mode==='bilateral-slot'&&support.trackConstraint.reference==='centerline')return Number(support.radius);
  const radialX = Math.cos(angle);
  const radialY = Math.sin(angle);
  const clearance = supportRadius(body, radialX, radialY) + Math.max(0, Number(support.thickness ?? 0)) / 2;
  return support.contactSide === 'outer'
    ? Math.max(1, Number(support.radius) + clearance)
    : Math.max(1, Number(support.radius) - clearance);
}

function placeGuidedBody(body, support, angle, tangentSpeed, world) {
  //world 参数是后加的，本来是气阻的说
  const point = guidedBodyPoint(body, support, angle);
  const tangent = circleTangent(angle);
  body.x = point.x;
  body.y = point.y;
  if (body.kind === 'box') body.angle = canonicalBoxAngle(Math.atan2(tangent.y, tangent.x));
  body.vx = tangent.x * tangentSpeed;
  body.vy = tangent.y * tangentSpeed;
}

function passedAngle(previousAngle, nextAngle, targetAngle) {
  if (!Number.isFinite(targetAngle) || Math.abs(nextAngle - previousAngle) < EPSILON) return false;
  const full = Math.PI * 2;
  const target = normalizedAngle(targetAngle);
  if (nextAngle > previousAngle) {
    let candidate = target + Math.ceil((previousAngle - target) / full) * full;
    if (candidate <= previousAngle + EPSILON) candidate += full;
    return candidate <= nextAngle + EPSILON;
  }
  let candidate = target + Math.floor((previousAngle - target) / full) * full;
  if (candidate >= previousAngle - EPSILON) candidate -= full;
  return candidate >= nextAngle - EPSILON;
}

function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return Math.hypot(px - x2, py - y2);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

// 复合体到圆弧的间隙
function comboGap(compound, support, angle, bodies) {
  if (compound.memberIds.every(id => bodies.get(id)?.physicsGeometry === 'point')) {
    return Math.max(0, Number(support.thickness ?? 0)) / 2;
  }
  const radialX = Math.cos(angle), radialY = Math.sin(angle);
  const cosine = Math.cos(compound.angle), sine = Math.sin(compound.angle);
  return Math.max(...compound.memberIds.map(id => {
    const body = bodies.get(id), offset = compound.offsets[id];
    if (!body || !offset) return 0;
    const rot_x = offset.x*cosine - offset.y*sine;
    const rot_y = offset.x*sine + offset.y*cosine;
    return rot_x*radialX + rot_y*radialY + supportRadius(body, radialX, radialY);
  })) + Math.max(0, Number(support.thickness ?? 0)) / 2;
}

//质心轨迹按质量加权回推
// function captureCompoundArc(compound, world, bodies) { 
// }
function tryCaptureCompoundArc(compound, world, bodies) {
  if (compound.trackState) return;
  const speed = Math.hypot(compound.vx, compound.vy);
  if (speed < EPSILON) return;
  const members = compound.memberIds.map(id => bodies.get(id));
  const previousX = members.reduce((sum, body) => sum + Number(body.mass) * Number(body.previousX ?? body.x), 0) / compound.mass;
  const previousY = members.reduce((sum, body) => sum + Number(body.mass) * Number(body.previousY ?? body.y), 0) / compound.mass;
  for (const support of world.supports) {
    if (support.kind !== 'arc'
      || (compound.lastTrackExit?.supportId === support.id && world.time - compound.lastTrackExit.time < 0.1)) continue;
    const constraint = trackRule(support);
    if (support.fullCircle === true && !constraint) continue;
    const entries = constraint
      ? constraint.entryPortals.map(portal => ({ angle: Number(portal.angle),
        direction: trackDir(portal.direction, 1), portal }))
      : [{ angle: Number(support.startAngle), direction: 1, portal: null },
        { angle: Number(support.endAngle), direction: -1, portal: null }];
    for (const { angle, direction, portal } of entries) {
      if (!Number.isFinite(angle)) continue;
      const tangent = circleTangent(angle);
      const tangentSpeed = compound.vx * tangent.x + compound.vy * tangent.y;
      const min_align = clamp(Number(portal?.minTangentAlignment ?? 0.7), 0, 1); //0.7 是试出来的，再低斜着进来会突然拐弯
      if (Math.sign(tangentSpeed) !== direction || Math.abs(tangentSpeed) / speed < min_align) continue;
      const clearance = comboGap(compound, support, angle, bodies);
      const radius = support.contactSide === 'outer'
        ? Number(support.radius) + clearance : Number(support.radius) - clearance;
      if (!Number.isFinite(radius) || radius <= 1) continue;
      if (support.trackConstraint?.mode !== 'bilateral-slot') {
        const acceleration = comboAcc(compound, world, members);
        const radialAcceleration = acceleration.x * Math.cos(angle) + acceleration.y * Math.sin(angle);
        const inward = tangentSpeed * tangentSpeed / radius + radialAcceleration;
        const normal = support.contactSide === 'outer' ? -inward : inward;
        if (normal < -EPSILON) continue;
      }
      const entryX = Number(support.cx) + radius * Math.cos(angle);
      const entryY = Number(support.cy) + radius * Math.sin(angle);
      const distance = distSeg(entryX, entryY, previousX, previousY, compound.x, compound.y);
      const stepReach = Math.max(2, speed * Number(world.stepDt ?? 0) * 1.5);
      if (distance > Math.max(Number(portal?.captureRadius ?? 12), stepReach)
        || Math.hypot(entryX - compound.x, entryY - compound.y) > stepReach) continue;
      compound.trackState = { supportId: support.id, angle, entryAngle: angle,
        entryOrientation: compound.angle, tangentSpeed, radius, direction,
        entryPortalId: portal ? String(portal.id ?? 'entry') : null,
        normalAcceleration: null, progressRadians: 0, visitedCheckpointIds: [] };
      compound.x = entryX; compound.y = entryY;
      compound.vx = tangent.x * tangentSpeed;
      compound.vy = tangent.y * tangentSpeed;
      putMembers(compound, bodies);
      return;
    }
  }
}

// 复合体加速度
function comboAcc(compound, world, members) {
  const external = members.reduce((sum, body) => {
    const mass = bodyMass(body);
    const force = forceAcceleration(body, world.pixelsPerMeter);
    sum.x += mass * force.x; sum.y += mass * force.y;
    return sum;
  }, { x: 0, y: 0 });
  return { x: external.x / compound.mass, y: world.gravity + external.y / compound.mass };
}

//摩擦加权平均
function comboArc(compound, world, dt, bodies) {
  const state = compound.trackState;
  const support = world.supports.find(item => item.id === state.supportId);
  if (!support) { compound.trackState = null; return; }
  const members = compound.memberIds.map(id => bodies.get(id));
  const acceleration = comboAcc(compound, world, members);
  const normalAt = (angle, speed) => {
    const radial = { x: Math.cos(angle), y: Math.sin(angle) };
    const inward = speed * speed / state.radius + acceleration.x * radial.x + acceleration.y * radial.y;
    return support.contactSide === 'outer' ? -inward : inward;
  };
  const normalBefore = normalAt(state.angle, state.tangentSpeed);
  if (normalBefore < -EPSILON && support.trackConstraint?.mode !== 'bilateral-slot') {
    releaseCompoundArc(compound, support, world);
    return;
  }
  const tangent = circleTangent(state.angle);
  const tan_acc = acceleration.x*tangent.x + acceleration.y*tangent.y;
  const friction = members.reduce((sum, body) => sum + Number(body.mass) * contactFriction(world, body, support), 0) / compound.mass;
  let nextSpeed = state.tangentSpeed + tan_acc * dt;
  const fric_delta = friction * Math.max(0, normalBefore) * dt;
  nextSpeed = Math.abs(nextSpeed) <= fric_delta ? 0 : nextSpeed - Math.sign(nextSpeed) * fric_delta;
  nextSpeed *= dragMultiplier(world.airDrag, dt);
  let nextAngle = state.angle + nextSpeed / state.radius * dt;
  if (friction === 0 && Number(world.airDrag ?? 0) === 0
    && members.every(body => Number(body.forceMagnitude ?? 0) === 0)) {
    const nextSquared = state.tangentSpeed ** 2
      + 2 * world.gravity * state.radius * (Math.sin(nextAngle) - Math.sin(state.angle));
    nextSpeed = Math.sign(nextSpeed || state.tangentSpeed || state.direction)
      * Math.sqrt(Math.max(0, nextSquared));
  }
  const normalAfter = normalAt(nextAngle, nextSpeed);
  if (normalAfter < 0 && support.trackConstraint?.mode !== 'bilateral-slot') {
    const fraction = clamp(normalBefore / Math.max(EPSILON, normalBefore - normalAfter), 0, 1);
    nextAngle = state.angle + (nextAngle - state.angle) * fraction;
    nextSpeed = state.tangentSpeed + (nextSpeed - state.tangentSpeed) * fraction;
    state.angle = nextAngle;
    state.tangentSpeed = nextSpeed;
    placeCompoundOnArc(compound, support, bodies);
    releaseCompoundArc(compound, support, world);
    return;
  }
  if (support.fullCircle !== true && !angleWithin(normalizedAngle(nextAngle), support.startAngle, support.endAngle)) {
    // 开口轨道上物体可能折返
    const start = Number(support.startAngle), end = Number(support.endAngle);
    const angularDistance = boundary => Math.abs(Math.atan2(
      Math.sin(nextAngle - boundary), Math.cos(nextAngle - boundary)));
    state.angle = angularDistance(start) < angularDistance(end) ? start : end;
    state.tangentSpeed = nextSpeed;//twe
    placeCompoundOnArc(compound, support, bodies);
    releaseCompoundArc(compound, support, world);
    return;
  }
  const previousAngle = state.angle;
  state.progressRadians += Math.abs(nextAngle - previousAngle);
  state.angle = nextAngle;
  state.tangentSpeed = nextSpeed;
  state.normalAcceleration = normalAfter;
  placeCompoundOnArc(compound, support, bodies);
  const constraint = trackRule(support);
  if (constraint) {
    markGates(state, constraint.checkpoints, previousAngle, nextAngle);
    const exit = constraint.exitPortals.find(portal => canExitGuidedTrack(state, portal, previousAngle, nextAngle));
    if (exit) {
      state.angle = Number(exit.angle);
      placeCompoundOnArc(compound, support, bodies);
      releaseCompoundArc(compound, support, world, exit);
    }
  }
}

function placeCompoundOnArc(compound, support, bodies) {
  const state = compound.trackState;
  const tangent = circleTangent(state.angle);
  compound.x = Number(support.cx) + state.radius * Math.cos(state.angle);
  compound.y = Number(support.cy) + state.radius * Math.sin(state.angle);
  compound.vx = tangent.x * state.tangentSpeed;
  compound.vy = tangent.y * state.tangentSpeed;
  compound.angle = state.entryOrientation + state.angle - state.entryAngle;

  putMembers(compound, bodies);
}

function releaseCompoundArc(compound, support, world, portal = null) {
  compound.lastTrackExit = { supportId: support.id, time: world.time, angle: compound.trackState.angle,
    portalId: portal ? String(portal.id ?? 'exit') : null,
    progressRadians: compound.trackState.progressRadians };
  compound.trackState = null;
}

// 都在轨道上时只跟同一根轨道
function sharesCollisionLayer(left, right) {
  //都在轨道上时只跟同一根轨道
  if (!left.trackState && !right.trackState) return true;
  return left.trackState?.supportId != null && left.trackState?.supportId === right.trackState?.supportId;
}


function forceAcceleration(body, pixelsPerMeter = PIXELS_PER_METER) {
  const magnitude = Number(body.forceMagnitude ?? 0);
  const angle = Number(body.forceAngle ?? 0) * Math.PI / 180;
  const inverseMass = 1 / bodyMass(body);
  return {
    x: magnitude * Math.cos(angle) * inverseMass * pixelsPerMeter,
    y: -magnitude * Math.sin(angle) * inverseMass * pixelsPerMeter,
  };
}

// 弹簧端点处理
function endPointOf(constraint, endpoint, anchors, bodies) {
  const start = endpoint === 'start';
  const bodyId = start ? constraint.startBodyId : constraint.bodyId;
  const anchorId = start ? constraint.anchorId : constraint.endAnchorId;
  const endpointBody = bodies.get(bodyId);
  if (endpointBody) {
    const localX = Number(constraint[start ? 'startAttachmentOffsetX' : 'endAttachmentOffsetX'] ?? 0);
    const localY = Number(constraint[start ? 'startAttachmentOffsetY' : 'endAttachmentOffsetY'] ?? 0);
    const angle = Number(endpointBody.angle ?? 0);
    return {
      ...endpointBody,
      x: Number(endpointBody.x) + localX * Math.cos(angle) - localY * Math.sin(angle),
      y: Number(endpointBody.y) + localX * Math.sin(angle) + localY * Math.cos(angle),
      body: endpointBody,
      fixed: endpointBody.fixed === true,
    };
  }
  const anchor = anchors.get(anchorId);
  if (anchor) return { ...anchor, body: null, fixed: true, vx: 0, vy: 0 };
  const xKey = start ? 'startX' : 'endX';
  const yKey = start ? 'startY' : 'endY';
  const attachmentMode = start ? constraint.startAttachmentMode : constraint.endAttachmentMode;
  return {
    x: Number(constraint[xKey]),
    y: Number(constraint[yKey]),
    vx: 0,
    vy: 0,
    body: null,
    fixed: attachmentMode === 'fixed',
  };
}

// 接触式弹簧的端点
function automaticSpringContact(constraint, endpoint, opposite, bodies) {
  if (!opposite || !Number.isFinite(opposite.x) || !Number.isFinite(opposite.y)) return null;
  const targetId = endpoint === 'start'
    ? constraint.startContactTargetBodyId : constraint.endContactTargetBodyId;
  const storedDx = Number(constraint.endX) - Number(constraint.startX);
  const storedDy = Number(constraint.endY) - Number(constraint.startY);
  const storedLength = Math.hypot(storedDx, storedDy);
  const baseX = storedLength > EPSILON ? storedDx / storedLength : 1;
  const baseY = storedLength > EPSILON ? storedDy / storedLength : 0;
  const outwardX = endpoint === 'end' ? baseX : -baseX;
  const outwardY = endpoint === 'end' ? baseY : -baseY;
  const restLength = Math.max(10, Number(constraint.length ?? storedLength ?? 220));
  let best = null;
  for (const candidate of bodies.values()) {
    // 题里指定的接触允许分开、

    if (targetId && candidate.id !== targetId) continue;
    if (['ball', 'box'].includes(candidate.kind)) {
      if (candidate.id !== opposite.body?.id && candidate.fixed !== true) {
        const relativeX = candidate.x - opposite.x;
        const relativeY = candidate.y - opposite.y;
        const projection = relativeX*outwardX + relativeY*outwardY;
        const transverse = Math.abs(relativeX*-outwardY + relativeY*outwardX);
        const radius = supportRadius(candidate, outwardX, outwardY);
        const surfaceDistance = projection - radius;
        const compression = restLength - surfaceDistance;
        if (surfaceDistance <= EPSILON || compression <= 0 || transverse > radius + 14) continue;
        if (best && best.compression <= compression) continue;
        best = { ...candidate, x: opposite.x + outwardX*surfaceDistance, y: opposite.y + outwardY*surfaceDistance,
          body: candidate, fixed: false, compression };
      }
    }
  }
  return best;
}

// 找不到接触就按原长摆在轴线上
function naturalSpringEndpoint(constraint, endpoint, opposite) {
  const storedDx = Number(constraint.endX) - Number(constraint.startX);
  const storedDy = Number(constraint.endY) - Number(constraint.startY);
  const storedLength = Math.hypot(storedDx, storedDy);
  const baseX = storedLength > EPSILON ? storedDx / storedLength : 1;
  const baseY = storedLength > EPSILON ? storedDy / storedLength : 0;
  const direction = endpoint === 'end' ? 1 : -1;
  const restLength = Math.max(10, Number(constraint.length ?? storedLength ?? 220));
	return {
		x: opposite.x + baseX * direction * restLength,
		y: opposite.y + baseY * direction * restLength,
		vx: Number(opposite.vx ?? 0), vy: Number(opposite.vy ?? 0),
		body: null, fixed: false,
	};
}

function springNow(constraint, anchors, bodies) {
  let start = endPointOf(constraint, 'start', anchors, bodies);
  let end = endPointOf(constraint, 'end', anchors, bodies);
  const startMode = constraint.startAttachmentMode ?? (constraint.startBodyId ? 'attached' : constraint.anchorId ? 'fixed' : 'free');
  const endMode = constraint.endAttachmentMode ?? (constraint.bodyId ? 'attached' : constraint.endAnchorId ? 'fixed' : 'free');
  if (endMode === 'contact' && !end.body) {
    end = automaticSpringContact(constraint, 'end', start, bodies) ?? naturalSpringEndpoint(constraint, 'end', start);
  }
  if (startMode === 'contact' && !start.body) {
    start = automaticSpringContact(constraint, 'start', end, bodies) ?? naturalSpringEndpoint(constraint, 'start', end);
  }
  return { start, end, startMode, endMode };
}

//弹簧的力的叠加
function springAcceleration(body, constraints, anchors, bodies) {
  let fx = 0;
  let fy = 0;
  for (const constraint of constraints) {
    if (constraint.kind !== 'spring') continue;
    const { start, end, startMode, endMode } = springNow(constraint, anchors, bodies);
    const bodyIsStart = start.body?.id === body.id;
    const bodyIsEnd = end.body?.id === body.id;
    if (!bodyIsStart && !bodyIsEnd) continue;
    if (![start.x, start.y, end.x, end.y].some(v => !Number.isFinite(v))) continue;
    if (!start.body && !start.fixed || !end.body && !end.fixed) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy) || 1;
    const stretch = distance - Number(constraint.length ?? distance);
    if ((startMode === 'contact' || endMode === 'contact') && stretch >= 0) continue;
    const k = Number(constraint.stiffness ?? 32);
    const c = Number(constraint.damping ?? 0);
    const relativeVx = Number(end.vx ?? 0) - Number(start.vx ?? 0);
    const relativeVy = Number(end.vy ?? 0) - Number(start.vy ?? 0);
    const radialVelocity = (relativeVx * dx + relativeVy * dy) / distance;
    const force = -k*stretch - c*radialVelocity;
    const direction = bodyIsEnd ? 1 : -1;
    fx += direction * (force * dx / distance) / bodyMass(body);
    fy += direction * (force * dy / distance) / bodyMass(body);
  }
  return { x: fx, y: fy };
}

// 绳的约束求解
function solveRopes(world, anchors, bodies) {//只能拉
  for (const constraint of world.constraints) {
    if (constraint.kind !== 'rope') continue;
    if (constraint.startBodyId && constraint.bodyId) {
      const start=endPointOf(constraint,'start',anchors,bodies);
      const end=endPointOf(constraint,'end',anchors,bodies);
      if(!start.body||!end.body||start.body===end.body)continue;
      const dx=end.x-start.x,dy=end.y-start.y,distance=Math.hypot(dx,dy);
      if(distance<constraint.length||distance<EPSILON)continue;
      const nx=dx/distance,ny=dy/distance;
      const wa=start.body.fixed?0:1/bodyMass(start.body),wb=end.body.fixed?0:1/bodyMass(end.body),sum=wa+wb;
      if(!sum)continue;
      const excess=Math.max(0,distance-constraint.length);
      start.body.x+=nx*excess*wa/sum;start.body.y+=ny*excess*wa/sum;
      end.body.x-=nx*excess*wb/sum;end.body.y-=ny*excess*wb/sum;
      const separating=(end.body.vx-start.body.vx)*nx+(end.body.vy-start.body.vy)*ny;
      if(separating>0){
        const impulse=separating/sum;
        start.body.vx+=nx*impulse*wa;start.body.vy+=ny*impulse*wa;
        end.body.vx-=nx*impulse*wb;end.body.vy-=ny*impulse*wb;
      }
      registerContact(world,start.body.id,constraint.id);registerContact(world,end.body.id,constraint.id);
      continue;
    }
    // 单端绳
    const anchor = anchors.get(constraint.anchorId);
    const body = bodies.get(constraint.bodyId);
    if (!anchor || !body) continue;
    const dx = body.x - anchor.x;
    const dy = body.y - anchor.y;
    const distance = Math.hypot(dx, dy) || 1;
    const length = Number(constraint.length ?? distance);
    if (distance <= length) continue;
    const nx = dx / distance;
    const ny = dy / distance;
    body.x = anchor.x + nx * length;
    body.y = anchor.y + ny * length;
    const outwardSpeed = body.vx * nx + body.vy * ny;
    if (outwardSpeed > 0) {
      body.vx -= outwardSpeed * nx;
      body.vy -= outwardSpeed * ny;
    }
    registerContact(world, body.id, constraint.id);
  }
}

//复合体
function comboShape(compound, world, bodies) {
  const members = compound.memberIds.map(id => bodies.get(id)).filter(Boolean);
  if (members.length !== compound.memberIds.length) return null;
  const point = members.every(body => body.physicsGeometry === 'point');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const body of members) {
    const offset = compound.offsets[body.id] ?? { x: 0, y: 0 };
    const localX = Number(offset.x), localY = Number(offset.y);
    const bodyRadius = body.kind === 'ball' ? Number(body.radius) : 0;
    const half_w = body.physicsGeometry === 'point' ? 0 : body.kind === 'ball' ? bodyRadius : Number(body.width) / 2;
    const half_h = body.physicsGeometry === 'point' ? 0 : body.kind === 'ball' ? bodyRadius : Number(body.height) / 2;
    minX = Math.min(minX, localX - half_w); maxX = Math.max(maxX, localX + half_w);
    minY = Math.min(minY, localY - half_h); maxY = Math.max(maxY, localY + half_h);
  }
  // 接触外形中心和质心把轻的放在上面
  const localCenterX = point ? 0 : (minX + maxX) / 2;
  const localCenterY = point ? 0 : (minY + maxY) / 2;
  const cosine = Math.cos(compound.angle), sine = Math.sin(compound.angle);
  const centerX = localCenterX * cosine - localCenterY * sine;
  const centerY = localCenterX * sine + localCenterY * cosine;
  const weightedPrevious = (previousKey, currentKey) => members.reduce((sum, body) => sum
    + bodyMass(body) * Number(body[previousKey] ?? body[currentKey] ?? 0), 0) / compound.mass;
  return { id: compound.id, role: 'body', kind: 'box',
    physicsGeometry: point ? 'point' : 'solid', compoundMemberIds: [...compound.memberIds],
    mass: compound.mass, x: compound.x + centerX, y: compound.y + centerY, vx: compound.vx, vy: compound.vy,
    angle: compound.angle, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY),
    previousX: weightedPrevious('previousX', 'x') + centerX,
    previousY: weightedPrevious('previousY', 'y') + centerY,
    previousVx: weightedPrevious('previousVx', 'vx'),
    previousVy: weightedPrevious('previousVy', 'vy') };
}

// 拿包围盒去解支撑面，解完把位移和速度同步回复合体
function resolveCompoundSegment(compound, support, world, bodies) {
  const contactBody = comboShape(compound, world, bodies);
  if (!contactBody) return;
  const beforeX = contactBody.x, beforeY = contactBody.y;
  const key = contactPairKey(contactBody.id, support.id);
  resolveSegment(contactBody, support, world);
  if (!world.contactKeys.has(key)) return;
  compound.x += contactBody.x - beforeX; compound.y += contactBody.y - beforeY;
  compound.vx = contactBody.vx; compound.vy = contactBody.vy;
  compound.angle = contactBody.angle;
  putMembers(compound, bodies);
  for (const memberId of compound.memberIds) registerContact(world, memberId, support.id);
}

// 线段支撑的主入口：先把两端裁掉，再按物体类型分派
function resolveSegment(body, support, world) {
  const dx = support.x2 - support.x1;
  const dy = support.y2 - support.y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return;
  const length = Math.sqrt(lengthSquared);
  const tx = dx / length;
  const ty = dy / length;
  const inf_extent = support.collisionExtent === 'infinite'
    || (support.semanticType === 'ground' && support.collisionExtent !== 'finite');
  const tan_dist = (body.x - support.x1) * tx + (body.y - support.y1) * ty;
  // 往凹槽里画墙时墙一开始是插在地板下面的：视觉/审计端点保留接缝，
  // 碰撞不保留
  const insetStart = inf_extent ? 0 : Math.max(0, Number(support.collisionInsetStart ?? 0));
  const insetEnd = inf_extent ? 0 : Math.max(0, Number(support.collisionInsetEnd ?? 0));
  // 示意质点要等参考点进到线段里才算碰到，
  // 它画出来的矩形/圆不能先把下一个面激活
  if (body.physicsGeometry === 'point' && !inf_extent
    && (tan_dist < insetStart - EPSILON || tan_dist > length - insetEnd + EPSILON
      || (tan_dist <= insetStart + EPSILON && hasConnectedEndpoint(world, support.id, 'start')))) return;
  const tan_radius = body.physicsGeometry === 'point' ? 0 : body.kind === 'ball'
    ? Number(body.radius)
    : supportRadius(body, tx, ty);
  if (!inf_extent && nearJoint(body, support, world, tan_dist, tan_radius, length, tx, ty)) return;
  if (['box', 'wedge', 'groove', 'half-groove'].includes(body.kind)) {
    resolveBoxSegment(body, support, world, dx, dy, lengthSquared, inf_extent);
    return;
  }
  // 圆和点：找最近点，法向就是连线方向，重合了才取垂线
  const rawT = ((body.x - support.x1) * dx + (body.y - support.y1) * dy) / lengthSquared;
  const t = inf_extent ? rawT : clamp(rawT, insetStart / length, (length - insetEnd) / length);
  const px = support.x1 + dx * t;
  const py = support.y1 + dy * t;
  let nx = body.x - px;
  let ny = body.y - py;
  let distance = Math.hypot(nx, ny);
  if (distance < EPSILON) {
    nx = -dy;
    ny = dx;
    distance = Math.hypot(nx, ny) || 1;
    if (ny > 0) {
      nx *= -1;
      ny *= -1;
    }
  }
  nx /= distance;
  ny /= distance;
  const radius = supportRadius(body, nx, ny);
  if (distance >= radius + Number(support.thickness ?? 6) / 2) return;

  const penetration = radius + Number(support.thickness ?? 6) / 2 - distance;
  body.x += nx * penetration;
  body.y += ny * penetration;
  bounceVelocity(body, nx, ny, support, world, {
    preserveGuideDirection: cornerEntry(body, support, world, rawT),
  });
  registerContact(world, body.id, support.id);
}

// 盒子撞线段：先把盒子摆正到贴着面，角度变了支撑半径也变，得重算一遍
function resolveBoxSegment(body, support, world, dx, dy, lengthSquared, inf_extent = false) {
  const length = Math.sqrt(lengthSquared);
  const tx = dx / length;
  const ty = dy / length;
  let nx = -ty;
  let ny = tx;
  if (ny > 0) {
    nx *= -1;
    ny *= -1;
  }

  const relativeX = body.x - support.x1;
  const relativeY = body.y - support.y1;
  const tan_dist = relativeX * tx + relativeY * ty;
  const tan_radius = body.physicsGeometry === 'point' ? 0 : supportRadius(body, tx, ty);
  const insetStart = inf_extent ? 0 : Math.max(0, Number(support.collisionInsetStart ?? 0));
  const insetEnd = inf_extent ? 0 : Math.max(0, Number(support.collisionInsetEnd ?? 0));
  if (!inf_extent && (body.physicsGeometry === 'point'
    ? tan_dist < insetStart - EPSILON || tan_dist > length - insetEnd + EPSILON
    : tan_dist + tan_radius <= insetStart || tan_dist - tan_radius >= length - insetEnd)) return;

  const sign_dist = relativeX * nx + relativeY * ny;
  // 零厚度的线对质点得判"这一帧有没有穿过去"，只判穿透的话快的一步就漏了
  if (body.physicsGeometry === 'point' && Math.abs(Number(support.thickness ?? 6)) <= EPSILON) {
    const prev_nd = (Number(body.previousX ?? body.x) - support.x1) * nx
      + (Number(body.previousY ?? body.y) - support.y1) * ny;
    const normalVelocity = body.vx * nx + body.vy * ny;
    const crossed = (prev_nd > EPSILON && sign_dist <= 0)
      || (prev_nd < -EPSILON && sign_dist >= 0)
      || (Math.abs(prev_nd) <= EPSILON && sign_dist <= 0 && normalVelocity < 0);
    if (crossed) {
      const side = prev_nd < -EPSILON ? -1 : 1;
      body.x -= sign_dist * nx;
      body.y -= sign_dist * ny;
      if (support.kind !== 'wall') body.angle = canonicalBoxAngle(Math.atan2(ty, tx));
      bounceVelocity(body, nx * side, ny * side, support, world);
      registerContact(world, body.id, support.id);
    }
    return;
  }
  if (sign_dist < 0) {
    nx *= -1;
    ny *= -1;
  }
  const distance = Math.abs(sign_dist);
  const radius = supportRadius(body, nx, ny);
  const targetDistance = radius + Number(support.thickness ?? 6) / 2;
  if (distance >= targetDistance) return;

  const previousAngle = Number(body.angle ?? 0);
  if (support.kind !== 'wall') body.angle = canonicalBoxAngle(Math.atan2(ty, tx));
  const alignedTargetDistance = supportRadius(body, nx, ny) + Number(support.thickness ?? 6) / 2;
  const penetration = alignedTargetDistance - distance;
  if (penetration <= 0) {
    body.angle = previousAngle;
    return;
  }
  body.x += nx * penetration;
  body.y += ny * penetration;
  const rawT = tan_dist / length;
  bounceVelocity(body, nx, ny, support, world, {
    preserveGuideDirection: cornerEntry(body, support, world, rawT),
  });
  registerContact(world, body.id, support.id);
}

// 拐角处特意压住法向反射：题里写"平滑连接"的时候不能按墙弹
function cornerEntry(body, support, world, rawT) {
  if (!Number.isFinite(rawT)) return 0;
  // 墙是障碍不是路：贴着墙边落到旁边地板上，不能把竖直速度掰成沿地板滑
  if (support.kind === 'wall') return 0;
  const targetDx = Number(support.x2) - Number(support.x1);
  const targetDy = Number(support.y2) - Number(support.y1);
  const targetLength = Math.hypot(targetDx, targetDy);
  if (targetLength < EPSILON) return 0;
  const endpointFraction = (supportRadius(body, targetDx / targetLength, targetDy / targetLength) + 6) / targetLength;
  if (rawT > endpointFraction && rawT < 1 - endpointFraction) return 0;
  const targetAnchor = rawT <= 0.5 ? 'start' : 'end';
  const connection = world.connections.find((item) => item?.kind === 'coincident' && (
    (item.left?.componentId === support.id && item.left?.anchor === targetAnchor)
      || (item.right?.componentId === support.id && item.right?.anchor === targetAnchor)
  ));
  if (!connection) return 0;
  // 题里写平滑连接/无碰撞的拐角：拐过去不损失速度，下一面再糙也等滑过去再算摩擦
  const smoothCorner = connection.smooth === true;
  if (!smoothCorner && contactFriction(world, body, support) > EPSILON) return 0;
  const targetIsLeft = connection.left?.componentId === support.id && connection.left?.anchor === targetAnchor;
  const otherEnd = targetIsLeft ? connection.right : connection.left;
  const previousSupport = world.supports.find((item) => item.id === otherEnd?.componentId && item.id !== support.id);
  if (!previousSupport || previousSupport.kind === 'arc' || previousSupport.kind === 'wall'
    || (!smoothCorner && contactFriction(world, body, previousSupport) > EPSILON)) return 0;

  const previousX = Number(body.previousX);
  const previousY = Number(body.previousY);
  if (!Number.isFinite(previousX) || !Number.isFinite(previousY)) return 0;
  const previousDx = Number(previousSupport.x2) - Number(previousSupport.x1);
  const previousDy = Number(previousSupport.y2) - Number(previousSupport.y1);
  const previousLength = Math.hypot(previousDx, previousDy);
  if (previousLength < EPSILON) return 0;
  const previousTx = previousDx / previousLength;
  const previousTy = previousDy / previousLength;
  const previousAlong = (previousX - Number(previousSupport.x1)) * previousTx
    + (previousY - Number(previousSupport.y1)) * previousTy;
  const previousNormal = Math.abs((previousX - Number(previousSupport.x1)) * -previousTy
    + (previousY - Number(previousSupport.y1)) * previousTx);
  const previousRadius = supportRadius(body, -previousTy, previousTx)
    + Math.max(0, Number(previousSupport.thickness ?? 0)) / 2 + 4;
  const endpointMargin = supportRadius(body, previousTx, previousTy) + 6;
  const nearPreviousEndpoint = otherEnd?.anchor === 'start'
    ? previousAlong >= -endpointMargin && previousAlong <= endpointMargin
    : previousAlong >= previousLength - endpointMargin && previousAlong <= previousLength + endpointMargin;
  if (!nearPreviousEndpoint || previousNormal > previousRadius) return 0;

  const towardJointSign = otherEnd?.anchor === 'start' ? -1 : 1;
  const incomingSpeed = body.vx * previousTx * towardJointSign + body.vy * previousTy * towardJointSign;
  if (incomingSpeed <= EPSILON) return 0;
  return targetAnchor === 'start' ? 1 : -1;
}

// 单体贴圆弧。全圆两边都能贴，开口轨道只认声明的那一面
function resolveArc(body, support, world) {
  if (body.trackCooldown?.supportId === support.id) return;
  if (headingPortal(body, support)) return;
  const dx = body.x - support.cx;
  const dy = body.y - support.cy;
  const distance = Math.hypot(dx, dy);
  const angle = normalizedAngle(Math.atan2(dy, dx));
  const radialX = distance > EPSILON ? dx / distance : 1;
  const radialY = distance > EPSILON ? dy / distance : 0;
  let bodyRadius = supportRadius(body, radialX, radialY);
  let clearance = bodyRadius + Math.max(0, Number(support.thickness ?? 0)) / 2;
  if (support.fullCircle !== true && !angleWithin(angle, support.startAngle, support.endAngle)) return;
  const signedDistance = distance - Number(support.radius);
  const separation = Math.abs(signedDistance);
  if (separation >= clearance) return;

  // 盒子贴弧要先转向，转完半径会变，得按新姿态再判一次
  if (body.kind === 'box') {
    const previousAngle = Number(body.angle ?? 0);
    body.angle = canonicalBoxAngle(Math.atan2(radialY, radialX) + Math.PI / 2);
    bodyRadius = supportRadius(body, radialX, radialY);
    clearance = bodyRadius + Math.max(0, Number(support.thickness ?? 0)) / 2;
    if (separation >= clearance) {
      body.angle = previousAngle;
      return;
    }
  }

  // 声明了单侧轨道的就有真实的骑乘面，积分在中线两侧那点漂移
  // 不能偷偷换掉法向。整圆哪边来都接；开口轨道则死守声明的那面
  const side = support.fullCircle !== true && support.contactSide === 'inner' ? -1
    : support.fullCircle !== true && support.contactSide === 'outer' ? 1
      : signedDistance >= 0 ? 1 : -1;
  const nx = radialX * side;
  const ny = radialY * side;
  const penetration = Math.max(0, clearance - side * signedDistance);
  body.x += nx * penetration;
  body.y += ny * penetration;
  bounceVelocity(body, nx, ny, support, world, {
    preserveSmoothTrackSpeed: Number.isFinite(Number(support.pathRadiusMeters))
      && contactFriction(world, body, support) === 0,
  });
  registerContact(world, body.id, support.id);
}

// 接缝附近先别解，让相邻那一面接手，否则物体卡在缝里左右抖
function nearJoint(body, support, world, tan_dist, tan_radius, length, tx, ty) {
  const tangentSpeed = body.vx * tx + body.vy * ty;
  const crossSurfaceSpeed = Math.abs(body.vx * -ty + body.vy * tx);
  if (crossSurfaceSpeed < 0.75 * world.pixelsPerMeter) return false;
  const transitionMargin = Number(support.thickness ?? 6) / 2 + 2;
  if (
    tangentSpeed > EPSILON
      && tan_dist + tan_radius >= length - transitionMargin
      && hasConnectedEndpoint(world, support.id, 'end')
  ) return true;
  return tangentSpeed < -EPSILON
    && tan_dist - tan_radius <= transitionMargin
    && hasConnectedEndpoint(world, support.id, 'start');
}

function hasConnectedEndpoint(world, componentId, anchor) { // 查这个端点有没有跟别的支撑接上
  return world.connections.some((connection) => {
    if (connection?.kind !== 'coincident') return false;
    const leftMatches = connection.left?.componentId === componentId && connection.left?.anchor === anchor;
    const rightMatches = connection.right?.componentId === componentId && connection.right?.anchor === anchor;
    if (!leftMatches && !rightMatches) return false;
    const otherId = leftMatches ? connection.right?.componentId : connection.left?.componentId;
    return world.supports.some((support) => support.id === otherId);
  });
}

// 碰支撑面的统一出口：恢复系数、摩擦、传送带速度都在这里处理掉
function bounceVelocity(body, nx, ny, material, world, { preserveSmoothTrackSpeed = false, preserveGuideDirection = 0 } = {}) {
  const normalSpeed = body.vx * nx + body.vy * ny;
  if (normalSpeed >= 0) return;
  const restitution = bounceOf(world, body, material, true);
  if ((preserveSmoothTrackSpeed || preserveGuideDirection) && restitution === 0) {
    const tx = -ny;
    const ty = nx;
    const tangentSpeed = body.vx * tx + body.vy * ty;
    const speed = Math.hypot(body.vx, body.vy);
    const incidenceRatio = speed > EPSILON ? Math.abs(normalSpeed) / speed : 0;
    // 法向速度很小时那是离散积分从理想轨道上飘出来的一点，
    // 只有这种情况保速度；看得见角度的撞击就得把法向能量耗掉，
    // 不能白送成切向加速
    const continuousTrackContact = incidenceRatio <= 0.25;
    const constrainedTangentSpeed = preserveGuideDirection
      ? Math.sign(preserveGuideDirection) * speed
      : continuousTrackContact
        ? Math.sign(tangentSpeed || 1) * speed
      : tangentSpeed;
    body.vx = tx * constrainedTangentSpeed;
    body.vy = ty * constrainedTangentSpeed;
    return;
  }
  const impactThreshold = 0.25 * world.pixelsPerMeter;
  const targetNormalSpeed = Math.abs(normalSpeed) < impactThreshold ? 0 : -normalSpeed * restitution;
  const normalDelta = targetNormalSpeed - normalSpeed;
  body.vx += normalDelta * nx;
  body.vy += normalDelta * ny;
  const tx = -ny;
  const ty = nx;
  const surfaceTangentSpeed = material.kind === 'conveyor' ? Number(material.beltSpeed ?? 0) : 0;
  const tangentSpeed = body.vx * tx + body.vy * ty - surfaceTangentSpeed;
  const friction = contactFriction(world, body, material);
  const tangentDelta = clamp(tangentSpeed, -friction * normalDelta, friction * normalDelta);
  body.vx -= tangentDelta * tx;
  body.vy -= tangentDelta * ty;
  const previousRelativeTangent = Number(body.previousVx ?? body.vx) * tx
    + Number(body.previousVy ?? body.vy) * ty - surfaceTangentSpeed;
  const remainingRelativeTangent = tangentSpeed - tangentDelta;
  if (
    Math.abs(remainingRelativeTangent) < EPSILON
    && Math.abs(previousRelativeTangent) < 0.02 * world.pixelsPerMeter
    && Number.isFinite(body.previousX)
    && Number.isFinite(body.previousY)
  ) {
    // With semi-implicit integration gravity first moves a resting body a tiny distance
    // along an incline, then static friction cancels its velocity. Remove that artificial
    // relative displacement so a body below the Coulomb threshold does not creep forever.
    const relativeTravel = (body.x - body.previousX) * tx + (body.y - body.previousY) * ty
      - surfaceTangentSpeed * Number(world.stepDt ?? 0);
    body.x -= relativeTravel * tx;
    body.y -= relativeTravel * ty;
  }
}

// 恢复系数的优先级：粘合对直接 0 → 全局非弹性 0 → 材料里配的 → 全局弹性 1 →
// 都没有就取两边小的那个。顺序别动，动了能量审计对不上。
function bounceOf(world, left, right, foundationContact = false) {
  if (foundationContact && left?.compoundMemberIds?.length) {
    return Math.min(...world.bodies.filter(body => left.compoundMemberIds.includes(body.id))
      .map(body => bounceOf(world, body, right, true)));
  }
  if (!foundationContact && collisionBinding(world, left, right)) return 0;
  if (world.collisionMode === 'inelastic') return 0;
  // 弹性碰撞题（等质量交换速度）要 1，完全非弹性（子弹打木块）要 0，题面一般会写清楚
  const configured = contactMaterial(world, left, right);
  if (configured?.restitution != null) return clamp(Number(configured.restitution), 0, 1);
  if (!foundationContact && world.collisionMode === 'elastic') return 1;
  return Math.min(Number(left?.restitution ?? 1), Number(right?.restitution ?? 0));
}

// 出界回弹。只有 bounce 模式才调，open 模式直接飞出去
function resolveBounds(body, world) {
  // 以前这里还判过 body.kind==='wedge' 的情况，后来楔形不走这条路了
  //console.log('bounds', body.id)
  const radiusX = body.physicsGeometry === 'point' ? 0 : body.kind === 'ball' ? body.radius : body.width / 2;
  const radiusY = body.physicsGeometry === 'point' ? 0 : body.kind === 'ball' ? body.radius : body.height / 2;
  //画布边界，这几个数是跟视口对过的，别乱改
  const pad = 24;
  //顶边以前也弹的：if (body.y - radiusY < pad) { body.y = pad + radiusY; ... }
  //后来出的题都碰不到顶边，删了
  if (body.x - radiusX < pad) {
    body.x = pad + radiusX;
    bounceVelocity(body, 1, 0, { restitution: 0.72, friction: 0.08 }, world);
    registerContact(world, body.id, 'boundary:left');
  }
  if (body.x + radiusX > 1416) {
    body.x = 1416 - radiusX; //右边下边本来也想抽出去，忘了
    bounceVelocity(body, -1, 0, { restitution: 0.72, friction: 0.08 }, world);
    registerContact(world, body.id, 'boundary:right');
  }
  if (body.y + radiusY > 824) {
    body.y = 824 - radiusY;
    bounceVelocity(body, 0, -1, { restitution: 0.62, friction: 0.15 }, world);
    if (Math.abs(body.vy) < 3) body.vy = 0;//小于3就不弹了，看着舒服喵
    registerContact(world, body.id, 'boundary:bottom');
  }
}

// 按形状分派。顺序有讲究：凹槽先判，不然楔形会被当成普通盒子
function resolveBodyPair(a, b, world) {
  if (a.kind === 'groove' || a.kind === 'half-groove') return dealConcave(a, b, world);
  if (b.kind === 'groove' || b.kind === 'half-groove') return dealConcave(b, a, world);
  if (a.kind === 'wedge') return dealWedge(a, b, world);
  if (b.kind === 'wedge') return dealWedge(b, a, world);
  if (a.physicsGeometry === 'point' || b.physicsGeometry === 'point') {
    return resolvePointBodyPair(a, b, world);
  }
  if (a.kind === 'box' && b.kind === 'box') return dealBoxBox(a, b, world);
  if (a.kind === 'ball' && b.kind === 'box') return pushBallBox(a, b, world);
  if (a.kind === 'box' && b.kind === 'ball') return pushBallBox(b, a, world);
  return hitCircles(a, b, world);
}

// 质点参与的对撞单独走一套：点在盒子里和点在盒子外是两种算法
function resolvePointBodyPair(a, b, world) {
  const pointA = a.physicsGeometry === 'point';
  const pointB = b.physicsGeometry === 'point';
  if (pointA && pointB) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const contactTolerance = 2; //两像素内算贴上，再大就看着像悬空
    if (distance >= contactTolerance) return;
    const relativeX = b.vx - a.vx, relativeY = b.vy - a.vy;
    const relativeLength = Math.hypot(relativeX, relativeY);
    const nx = distance > EPSILON ? dx / distance
      : relativeLength > EPSILON ? -relativeX / relativeLength : 1;
    const ny = distance > EPSILON ? dy / distance
      : relativeLength > EPSILON ? -relativeY / relativeLength : 0;
    applyPairImpulse(a, b, nx, ny, contactTolerance - distance, world);
    registerContact(world, a.id, b.id);
    return;
  }
  const point = pointA ? a : b;
  const solid = pointA ? b : a;
  if (!['ball', 'box'].includes(solid.kind)) return;
  const halfWidth = solid.kind === 'ball' ? solid.radius : solid.width / 2;
  const halfHeight = solid.kind === 'ball' ? solid.radius : solid.height / 2;
  if (solid.kind === 'box'
    && point.x >= solid.x - halfWidth && point.x <= solid.x + halfWidth
    && point.y >= solid.y - halfHeight && point.y <= solid.y + halfHeight) {
    const faces = [
      { distance: point.x - (solid.x - halfWidth), nx: 1, ny: 0 },
      { distance: solid.x + halfWidth - point.x, nx: -1, ny: 0 },
      { distance: point.y - (solid.y - halfHeight), nx: 0, ny: 1 },
      { distance: solid.y + halfHeight - point.y, nx: 0, ny: -1 },
    ];
    // 上一步还贴着顶面或更高的，只可能是从顶面进来的：题里声明的骑乘者，
    // 或者从等高的邻面（"平台与小车上表面等高"）平移过来的
    const declaredTopSupport = Math.abs(Number(solid.angle ?? 0)) < EPSILON
      && Number(point.previousY) <= solid.y - halfHeight + 1
      && ([point.supportId, point.supportedBy, point.attachedTo].includes(solid.id) || point.vy - solid.vy >= -EPSILON);
    // 载具端点处侧面距离和顶面距离会打平，从上面来的声明骑乘者归顶面管，不归侧壁
    const face = declaredTopSupport ? faces[2]
      : faces.reduce((closest, candidate) => candidate.distance < closest.distance ? candidate : closest);
    // 正好落在面上的点会被积分先推进去零点几像素再解碰撞，
    // 对最近的那面解。要是用指向盒中心的向量，水平顶面接触会被算成斜撞，
    // 横向动量瞬间丢一大截
    applyPairImpulse(point, solid, face.nx, face.ny, Math.max(0, face.distance) + 1, world);
    registerContact(world, point.id, solid.id);
    return;
  }
  const nearestX = solid.kind === 'ball' ? solid.x : clamp(point.x, solid.x - halfWidth, solid.x + halfWidth);
  const nearestY = solid.kind === 'ball' ? solid.y : clamp(point.y, solid.y - halfHeight, solid.y + halfHeight);
  const dx = solid.x - point.x, dy = solid.y - point.y;
  const contactX = nearestX - point.x, contactY = nearestY - point.y;
  const distance = Math.hypot(contactX, contactY);
  const threshold = (solid.kind === 'ball' ? solid.radius : 0) + 1;
  if (distance >= threshold) return;
  // 沿水平盒顶滑到顶角上不算侧面撞：一旦到了盒子正上方就走上面的顶面规则
  if (solid.kind === 'box' && Math.abs(Number(solid.angle ?? 0)) < EPSILON
    && (point.x < solid.x - halfWidth || point.x > solid.x + halfWidth)
    && point.y <= solid.y - halfHeight + 1 && Number(point.previousY) <= solid.y - halfHeight + 1) return;
  const relativeX = solid.vx - point.vx, relativeY = solid.vy - point.vy;
  const relativeLength = Math.hypot(relativeX, relativeY);
  const normalLength = Math.hypot(contactX, contactY) || Math.hypot(dx, dy) || relativeLength || 1;
  const nx = distance > EPSILON ? contactX / normalLength
    : Math.hypot(dx, dy) > EPSILON ? dx / normalLength
      : relativeLength > EPSILON ? -relativeX / relativeLength : 1;
  const ny = distance > EPSILON ? contactY / normalLength
    : Math.hypot(dx, dy) > EPSILON ? dy / normalLength
      : relativeLength > EPSILON ? -relativeY / relativeLength : 0;
  applyPairImpulse(point, solid, nx, ny, threshold - distance, world);
  registerContact(world, point.id, solid.id);
}

// 楔形当一条斜线段处理，斜面法向朝上
function dealWedge(wedge, body, world) {
  if (['wedge', 'groove', 'half-groove'].includes(body.kind)) return;
  const halfWidth = Number(wedge.width) / 2;
  const halfHeight = Number(wedge.height) / 2;
  const angle = Number(wedge.angle ?? 0);
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const x1 = Number(wedge.x) - halfWidth * cosine + halfHeight * sine;
  const y1 = Number(wedge.y) - halfWidth * sine - halfHeight * cosine;
  const x2 = Number(wedge.x) + halfWidth * cosine - halfHeight * sine;
  const y2 = Number(wedge.y) + halfWidth * sine + halfHeight * cosine;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return;
  const tx = dx / length;
  const ty = dy / length;
  let nx = -ty;
  let ny = tx;
  if (ny > 0) {
    nx *= -1;
    ny *= -1;
  }

  const relativeX = Number(body.x) - x1;
  const relativeY = Number(body.y) - y1;
  const tan_dist = relativeX * tx + relativeY * ty;
  const tan_radius = supportRadius(body, tx, ty);
  if (body.physicsGeometry === 'point'
    ? tan_dist < -EPSILON || tan_dist > length + EPSILON
    : tan_dist + tan_radius <= 0 || tan_dist - tan_radius >= length) return;

  const sign_dist = relativeX * nx + relativeY * ny;
  const normalRadius = supportRadius(body, nx, ny);
  const pointTolerance = body.physicsGeometry === 'point' ? 2 : normalRadius;
  if (sign_dist < -pointTolerance || sign_dist >= pointTolerance) return;

  if (body.kind === 'box') body.angle = canonicalBoxAngle(Math.atan2(ty, tx));
  const alignedRadius = supportRadius(body, nx, ny);
  const penetration = alignedRadius - sign_dist;
  if (penetration <= 0) return;

  applyPairImpulse(wedge, body, nx, ny, penetration, world);
  registerContact(world, wedge.id, body.id);
}

// 凹槽/半槽：转到容器局部坐标里算，半径和角度域都得对，容易错
function dealConcave(container, body, world) {
  if (['wedge', 'groove', 'half-groove'].includes(body.kind)) return;
  const width = Math.max(1, Number(container.width));
  const height = Math.max(1, Number(container.height));
  const inset = Math.max(2, Number(container.trackInset ?? 12));
  const trackThickness = Math.max(0, Number(container.trackThickness ?? 8));
  const max_r = container.kind === 'groove'
    ? Math.min(width / 2 - inset, height - trackThickness / 2)
    : Math.min(width, height);
  const trackRadius = Math.max(12, Math.min(Number(container.trackRadius ?? max_r), max_r));
  const mirroredHalfGroove = container.kind === 'half-groove' && container.mirrorX === true;
  const localCenterX = container.kind === 'groove'
    ? 0
    : mirroredHalfGroove ? width / 2 - trackRadius : -width / 2 + trackRadius;
  const localCenterY = container.kind === 'groove' ? -height / 2 : height / 2 - trackRadius;
  const containerAngle = Number(container.angle ?? 0);
  const cosine = Math.cos(containerAngle);
  const sine = Math.sin(containerAngle);
  const relativeX = Number(body.x) - Number(container.x);
  const relativeY = Number(body.y) - Number(container.y);
  const localBodyX = relativeX * cosine + relativeY * sine;
  const localBodyY = -relativeX * sine + relativeY * cosine;
  const radialLocalX = localBodyX - localCenterX;
  const radialLocalY = localBodyY - localCenterY;
  const distance = Math.hypot(radialLocalX, radialLocalY);
  if (distance < EPSILON) return;
  const localAngle = normalizedAngle(Math.atan2(radialLocalY, radialLocalX));
  const insideAngularDomain = container.kind === 'groove'
    ? localAngle >= -EPSILON && localAngle <= Math.PI + EPSILON
    : mirroredHalfGroove
      ? localAngle >= -EPSILON && localAngle <= Math.PI / 2 + EPSILON
      : localAngle >= Math.PI / 2 - EPSILON && localAngle <= Math.PI + EPSILON;
  if (!insideAngularDomain) return;

  const radialWorldX = (radialLocalX / distance) * cosine - (radialLocalY / distance) * sine;
  const radialWorldY = (radialLocalX / distance) * sine + (radialLocalY / distance) * cosine;
  let bodyRadius = supportRadius(body, radialWorldX, radialWorldY);
  const contactInset = container.kind === 'half-groove' ? 0 : trackThickness / 2;
  let targetDistance = trackRadius - contactInset - bodyRadius;
  if (distance <= targetDistance || distance > trackRadius + bodyRadius + trackThickness) return;

  if (body.kind === 'box') {
    body.angle = canonicalBoxAngle(Math.atan2(radialWorldY, radialWorldX) + Math.PI / 2);
    bodyRadius = supportRadius(body, radialWorldX, radialWorldY);
    targetDistance = trackRadius - contactInset - bodyRadius;
  }
  const penetration = distance - targetDistance;
  if (penetration <= 0) return;

  applyPairImpulse(container, body, -radialWorldX, -radialWorldY, penetration, world);
  registerContact(world, container.id, body.id);
}

function hitCircles(a, b, world) { // 圆圆最简单，法向就是圆心连线
  const dx = b.x-a.x, dy = b.y-a.y;
  const distance = Math.hypot(dx, dy) || 1;
  const minimum = a.radius + b.radius;
  if (distance >= minimum) return;
  applyPairImpulse(a, b, dx/distance, dy/distance, minimum-distance, world);
  registerContact(world, a.id, b.id);
}

// 盒盒相撞，按穿透浅的那个轴分开
function dealBoxBox(a, b, world) {
  const overlapX = a.width/2 + b.width/2 - Math.abs(b.x-a.x);
  const overlapY = a.height/2 + b.height/2 - Math.abs(b.y-a.y);
  if (overlapX <= 0 || overlapY <= 0) return;
  //哪个方向浅就往哪个方向推开
  if (overlapX < overlapY) {
    applyPairImpulse(a, b, Math.sign(b.x-a.x) || 1, 0, overlapX, world);
  } else {
    applyPairImpulse(a, b, 0, Math.sign(b.y-a.y) || 1, overlapY, world);
  }
  registerContact(world, a.id, b.id);
}

// 球盒：先夹到盒子上找最近点；完全重合时按深浅挑一个轴推出去
function pushBallBox(ball, box, world) {
  const half_w = box.width/2, half_h = box.height/2;
  const px = clamp(ball.x, box.x-half_w, box.x+half_w);
  const py = clamp(ball.y, box.y-half_h, box.y+half_h);
  let dx = box.x - ball.x;
  let dy = box.y - ball.y;
  const fromClosestX = ball.x - px;
  const fromClosestY = ball.y - py;
  const distance = Math.hypot(fromClosestX, fromClosestY);
  if (distance >= ball.radius) return;
  if (distance > EPSILON) {
    dx = -fromClosestX/distance;
    dy = -fromClosestY/distance;
  } else if (Math.abs(dx) > Math.abs(dy)) {
    dx = Math.sign(dx) || 1;
    dy = 0;
  } else {
    dx = 0;
    dy = Math.sign(dy) || 1;
  }
  applyPairImpulse(ball, box, dx, dy, ball.radius-distance, world);
  registerContact(world, ball.id, box.id);
}

function registerContact(world, leftId, rightId) { // 接触键统一排序，免得 a|b 和 b|a 被当成两次接触
  const key = String(leftId) < String(rightId) ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
  world.contactKeys.add(key);
}

// 冲量主体：先按逆质量推开，再算法向冲量，最后补切向摩擦冲量
function applyPairImpulse(a, b, nx, ny, penetration, world) {
  const compoundA = world.compounds.find(item => item.memberIds.includes(a.id));
  const compoundB = world.compounds.find(item => item.memberIds.includes(b.id));
  const inverseA = compoundA ? 1 / compoundA.mass : inverseMass(a);
  const inverseB = compoundB ? 1 / compoundB.mass : inverseMass(b);
  const inverseSum = inverseA + inverseB;
  if (inverseSum <= EPSILON) return;
  const shift = (body, compound, dx, dy) => {
    if (!compound) { body.x += dx; body.y += dy; return; }
    compound.x += dx; compound.y += dy;
    for (const member of world.bodies.filter(item => compound.memberIds.includes(item.id))) {
      member.x += dx; member.y += dy;
    }
  };
  const kick = (body, compound, dvx, dvy) => {
    if (!compound) { body.vx += dvx; body.vy += dvy; return; }
    compound.vx += dvx; compound.vy += dvy;
    for (const member of world.bodies.filter(item => compound.memberIds.includes(item.id))) {
      member.vx += dvx; member.vy += dvy;
    }
  };
  shift(a, compoundA, -nx * penetration * inverseA / inverseSum, -ny * penetration * inverseA / inverseSum);
  shift(b, compoundB, nx * penetration * inverseB / inverseSum, ny * penetration * inverseB / inverseSum);
  const relativeX = b.vx - a.vx;
  const relativeY = b.vy - a.vy;
  const rel_n = relativeX * nx + relativeY * ny;
  if (rel_n >= 0) return;
  world.impactKeys.add(contactPairKey(a.id, b.id));
  const binding = collisionBinding(world, a, b);
  const impactState = binding ? bindingImpactState(world, a, b) : null;
  const restitution = bounceOf(world, a, b);
  // 这就是课本上那个式子，别自己推，推出来的符号容易反
  const impulse = -(1 + restitution) * rel_n / inverseSum;
  kick(a, compoundA, -impulse * nx * inverseA, -impulse * ny * inverseA);
  kick(b, compoundB, impulse * nx * inverseB, impulse * ny * inverseB);
  const tx = -ny;
  const ty = nx;
  const relativeTangent = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
  const friction = pairFriction(a, b, world);
  const tangentImpulse = clamp(-relativeTangent / inverseSum, -friction * impulse, friction * impulse);
  kick(a, compoundA, -tangentImpulse * tx * inverseA, -tangentImpulse * ty * inverseA);
  kick(b, compoundB, tangentImpulse * tx * inverseB, tangentImpulse * ty * inverseB);
  if (binding && !binding.active) stickPair(binding, a, b, world, impactState,
    contactPairKey(a.id, b.id));
}

// 粘合前的动量和动能快照，后面审计要看这个
function bindingImpactState(world, a, b) {
  const connected = world.compounds.filter(item => item.memberIds.includes(a.id) || item.memberIds.includes(b.id));
  const ids = new Set([a.id, b.id, ...connected.flatMap(item => item.memberIds)]);
  return world.bodies.filter(body => ids.has(body.id)).reduce((sum, body) => {
    const mass = bodyMass(body);
    sum.momentum.x += mass * Number(body.vx);
    sum.momentum.y += mass * Number(body.vy);
    sum.kinetic += mass * (Number(body.vx) ** 2 + Number(body.vy) ** 2) / 2;
    return sum;
  }, { momentum: { x: 0, y: 0 }, kinetic: 0 });
}

function collisionBinding(world, a, b) { // 找这一对背后有没有声明过的粘合
  const membersFor = id => world.compounds.find(item => item.memberIds.includes(id))?.memberIds ?? [id];
  const leftIds = membersFor(a.id), rightIds = membersFor(b.id);
  return world.collisionBindings?.find(binding => !binding.active
    && ((leftIds.includes(binding.leftId) && rightIds.includes(binding.rightId))
      || (leftIds.includes(binding.rightId) && rightIds.includes(binding.leftId))));
}

function sameCompound(world, leftId, rightId) { // 同一个复合体内部不解碰撞，不然自己跟自己打架
  return world.compounds.some(item => item.memberIds.includes(leftId) && item.memberIds.includes(rightId));
}

// 粘上：合成一个整体，质量和质心按质量加权，速度取共同速度
function stickPair(binding, a, b, world, impactState = null, impactPair = null) {
  const connected = world.compounds.filter(item => item.memberIds.includes(a.id) || item.memberIds.includes(b.id));
  const memberIds = [...new Set([a.id, b.id, ...connected.flatMap(item => item.memberIds)])];
  const bodies = world.bodies.filter(item => memberIds.includes(item.id));
  const joinedMemberIds = new Set(connected.flatMap(item => item.memberIds));
  const formerTracks = [...connected.map(item => item.trackState),
    ...bodies.filter(item => !joinedMemberIds.has(item.id)).map(item => item.trackState)];
  const mass = bodies.reduce((sum, body) => sum + bodyMass(body), 0);
  const weighted = field => bodies.reduce((sum, body) => sum + bodyMass(body) * Number(body[field]), 0) / mass;
  const x = weighted('x'), y = weighted('y'), vx = weighted('vx'), vy = weighted('vy');
  // 预连接的装置在编辑器里还要保留各自的零件，只有碰撞粘合
  // 才生成那个替代用的整体字形，动力学上是共享的
  const formationKind = binding.kind === 'rigid-from-start'
    && connected.every(item => item.formationKind === 'initial-assembly')
    ? 'initial-assembly' : 'collision-adhesion';
  const compound = { id: memberIds.slice().sort().join('|'), memberIds, mass, x, y, vx, vy,
    formationKind,
    formedAt: world.time, originX: x, originY: y,
    angle: 0, offsets: Object.fromEntries(bodies.map(body => [body.id, { x: body.x - x, y: body.y - y }])),
    trackState: null, lastTrackExit: null };
  world.compounds = world.compounds.filter(item => !connected.includes(item));
  world.compounds.push(compound);
  binding.offset = { x: b.x - a.x, y: b.y - a.y };
  binding.active = true;
  world.adhesionEvents.push({ time: world.time, memberIds: [...memberIds], mass,
    bindingPair: contactPairKey(binding.leftId, binding.rightId), impactPair,
    momentumBefore: impactState?.momentum ?? { x: mass * vx, y: mass * vy },
    momentumAfter: { x: mass * vx, y: mass * vy }, velocityAfter: { x: vx, y: vy },
    kineticBefore: impactState?.kinetic ?? mass * (vx * vx + vy * vy) / 2,
    kineticAfter: mass * (vx * vx + vy * vy) / 2 });
  carryArc(compound, formerTracks, world);
  for (const body of bodies) body.trackState = null;
  putMembers(compound, new Map(world.bodies.map(item => [item.id, item])));
}

// 粘合正好发生在弧上的时候顺手接管轨道，不然会当场掉下去
function carryArc(compound, formerTracks, world) {
  if (!formerTracks.length || formerTracks.some(state => !state?.supportId)) return;
  const supportId = formerTracks[0].supportId;
  if (formerTracks.some(state => state.supportId !== supportId)) return;
  const support = world.supports.find(item => item.id === supportId && item.kind === 'arc');
  if (!support) return;
  const bodies = new Map(world.bodies.map(body => [body.id, body]));
  const angle = Math.atan2(compound.y - Number(support.cy), compound.x - Number(support.cx));
  if (support.fullCircle !== true && !angleWithin(normalizedAngle(angle), support.startAngle, support.endAngle)) return;
  const clearance = comboGap(compound, support, angle, bodies);
  const radius = support.contactSide === 'outer'
    ? Number(support.radius) + clearance : Number(support.radius) - clearance;
  if (!Number.isFinite(radius) || radius <= 1) return;
  const tangent = circleTangent(angle);
  const tangentSpeed = compound.vx * tangent.x + compound.vy * tangent.y;
  const maximumProjection = Math.max(2, Math.abs(tangentSpeed) * Number(world.stepDt ?? 0) * 1.5);
  if (Math.abs(Math.hypot(compound.x - Number(support.cx), compound.y - Number(support.cy)) - radius)
    > maximumProjection) return;
  const members = compound.memberIds.map(id => bodies.get(id));
  const acceleration = comboAcc(compound, world, members);
  const inward = tangentSpeed * tangentSpeed / radius
    + acceleration.x * Math.cos(angle) + acceleration.y * Math.sin(angle);
  const normal = support.contactSide === 'outer' ? -inward : inward;
  if (support.trackConstraint?.mode !== 'bilateral-slot' && normal < -EPSILON) return;
  compound.trackState = { supportId, mode: support.trackConstraint?.mode ?? 'unilateral-track',
    depthLayer: 'track', angle, entryAngle: angle, entryOrientation: compound.angle,
    tangentSpeed, radius, direction: Math.sign(tangentSpeed) || 1,
    entryPortalId: null, normalAcceleration: normal, progressRadians: 0,
    visitedCheckpointIds: [] };
  compound.x = Number(support.cx) + radius * Math.cos(angle);
  compound.y = Number(support.cy) + radius * Math.sin(angle);
  compound.vx = tangent.x * tangentSpeed;
  compound.vy = tangent.y * tangentSpeed;
}

// 把复合体的位姿写回每个成员，偏移要跟着一起转
function putMembers(compound, bodies) {
  const cosine = Math.cos(compound.angle), sine = Math.sin(compound.angle);
  for (const id of compound.memberIds) {
    const body = bodies.get(id), offset = compound.offsets[id];
    if (!body || !offset) continue;
    body.x = compound.x + offset.x * cosine - offset.y * sine;
    body.y = compound.y + offset.x * sine + offset.y * cosine;
    body.vx = compound.vx;
    body.vy = compound.vy;
    if (body.kind === 'box' && compound.trackState) body.angle = canonicalBoxAngle(compound.angle);
  }
}

// 反算：成员被外力推过之后，把复合体的质心拉回来对齐
function syncBinds(world, bodies) {
  for (const compound of world.compounds) {
    if (compound.trackState) {
      putMembers(compound, bodies);
      continue;
    }
    const members = compound.memberIds.map(id => bodies.get(id)).filter(Boolean);
    if (members.length !== compound.memberIds.length) continue;
    const weighted = field => members.reduce((sum, body) => sum + bodyMass(body) * Number(body[field]), 0) / compound.mass;
    compound.x = weighted('x'); compound.y = weighted('y');
    compound.vx = weighted('vx'); compound.vy = weighted('vy');
    putMembers(compound, bodies);
  }
}

// 摩擦系数查找。优先级一路往下掉：
// 复合体按质量加权 → 摩擦区 → 老场景兜底 → 材料表 → 容器内壁 → 单边配置 → 几何均值。
function pairFriction(a, b, world) {
  if (a?.compoundMemberIds?.length) {
    return world.bodies.filter(body => a.compoundMemberIds.includes(body.id))
      .reduce((sum, body) => sum + bodyMass(body) * pairFriction(body, b, world), 0) / bodyMass(a);
  }
  if (b?.compoundMemberIds?.length) return pairFriction(b, a, world);
  // 支撑面能沿长度带摩擦区（防滑条、粗糙MN段）：人在区里就听区的
  const zoned = zoneFriction(a, b) ?? zoneFriction(b, a);
  if (zoned != null) return zoned;
  if (a.semanticType === 'legacy-strip' || b.semanticType === 'legacy-strip') {
    //给老场景兜底的，现在走不到，先留着
    return clamp(Math.max(Number(a.friction ?? 0), Number(b.friction ?? 0)), 0, 1.5);
  }
  const configured = contactMaterial(world, a, b);
  if (configured) return clamp(Number(configured.friction ?? 0), 0, 1.5);
  if (a.semanticType === 'container' && [b.supportId, b.supportedBy, b.attachedTo].includes(a.id)) {
    return clamp(Number(a.internalSurfaceFriction ?? 0), 0, 1.5);
  }
  if (b.semanticType === 'container' && [a.supportId, a.supportedBy, a.attachedTo].includes(b.id)) {
    return clamp(Number(b.internalSurfaceFriction ?? 0), 0, 1.5);
  }
  if (a.role === 'support' && a.frictionConfigured === true) return clamp(Number(a.friction ?? 0), 0, 1.5);
  if (b.role === 'support' && b.frictionConfigured === true) return clamp(Number(b.friction ?? 0), 0, 1.5);
  if (a.frictionConfigured === true && b.frictionConfigured === true) {
    return clamp(Math.sqrt(Math.max(0, Number(a.friction ?? 0)) * Math.max(0, Number(b.friction ?? 0))), 0, 1.5);
  }
  if (a.frictionConfigured === true) return clamp(Number(a.friction ?? 0), 0, 1.5);
  if (b.frictionConfigured === true) return clamp(Number(b.friction ?? 0), 0, 1.5);
  return 0;
}

function zoneFriction(support, body) { // 摩擦区按沿支撑方向的位置判，斜面一样适用
  if (support?.role !== 'support' || !Array.isArray(support.frictionZones) || !support.frictionZones.length
    || body?.role !== 'body') return null;
  const dx = Number(support.x2) - Number(support.x1), dy = Number(support.y2) - Number(support.y1);
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const along = ((Number(body.x) - Number(support.x1)) * dx + (Number(body.y) - Number(support.y1)) * dy) / length;
  const zone = support.frictionZones.find(item => along >= Number(item.start) && along <= Number(item.end));
  return zone ? clamp(Number(zone.friction ?? 0), 0, 1.5) : null;
}

// 这层就是给上面留个口子，别的地方统一叫 contactFriction
function contactFriction(world, left, right) {
  return pairFriction(left, right, world);
}

// 引擎在身体和支撑面之间实际用的摩擦系数：
// 外面的核对（能量审计那些）要跟积分器用的一致
export function muOn(world, body, support) {
  return body && support ? contactFriction(world, body, support) : 0;
}

function contactMaterial(world, left, right) { // 材料表是对称的，键在存的时候就排过序了
  return world.contactMaterials?.get(contactPairKey(left?.id, right?.id)) ?? null;
}

function contactPairKey(leftId, rightId) { // 两两配对的键，永远小的在前
  const left = String(leftId ?? '');
  const right = String(rightId ?? '');
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}
function inverseMass(body) { // 固定物体当无穷大质量，逆质量给 0
  return body.fixed === true ? 0 : 1 / bodyMass(body);
}

// 盒子在某个方向上的支撑半径：把半宽半高投到法向上
function supportRadius(body, nx, ny) {
  if (body.physicsGeometry === 'point') return 0;
  if (body.kind === 'ball') return Number(body.radius);
  const angle = Number(body.angle ?? 0);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const proj_x = nx * cosine + ny * sine;
  const proj_y = nx * -sine + ny * cosine;
  return Math.abs(proj_x) * Number(body.width) / 2
    + Math.abs(proj_y) * Number(body.height) / 2;
}

// 能量和动量每步重算，题目里要对数的，慢一点也认了
function calculateMetrics(world, anchors, bodies) {
  const pixelsPerMeter = world.pixelsPerMeter;
  let kinetic = 0;
  let potential = 0;
  let spring = 0;
  let px = 0;
  let py = 0;
  for (const body of world.bodies) {
    if (body.fixed === true) continue;
    const vx = body.vx / pixelsPerMeter;
    const vy = body.vy / pixelsPerMeter;
    kinetic += 0.5 * body.mass * (vx * vx + vy * vy);
    //势能零点取场景那条参考线
    potential += body.mass * (world.gravity / pixelsPerMeter) * ((world.potentialReferenceY - body.y) / pixelsPerMeter);
    px += body.mass * vx;
    py += body.mass * vy;
  }
  for (const constraint of world.constraints) {
    if (constraint.kind !== 'spring') continue;
    const { start, end, startMode, endMode } = springNow(constraint, anchors, bodies);
    if (![start.x, start.y, end.x, end.y].some(v => !Number.isFinite(v))) continue;
    if (!start.body && !start.fixed || !end.body && !end.fixed) continue;
    const stretchMeters = (Math.hypot(end.x - start.x, end.y - start.y) - constraint.length) / pixelsPerMeter;
    if ((startMode === 'contact' || endMode === 'contact') && stretchMeters >= 0) continue;
    spring += 0.5 * constraint.stiffness * stretchMeters * stretchMeters;
  }
  world.energy = kinetic + potential + spring;
  // 复合弹簧的弹性势能单独加：解放之前按压缩量算，之后不再计
  if(world.hybridProcess){
    let stored=0;
    for(const c of world.hybridSprings){
      const meta=c.hybridSpring,position=(bodies.get(world.hybridProcess.bindings.bodies[meta.role]).x-meta.originX)/pixelsPerMeter;
      const compression=Math.max(0,meta.restLength-meta.direction*(position-meta.anchor));
      const released=world.hybridProcess.model.phases.some(p=>p.end<=world.time+1e-12&&p.laws[meta.role]?.kind==='harmonic');
      if(!released)stored+=.5*c.stiffness*compression**2;
    }
    world.energy+=stored;world.energyStages={springEnergy:stored,kineticEnergy:kinetic,timing:'physical'};
  }
  if (world.energyMotion) {
    const actor=bodies.get(world.energyMotion.ids.rider);
    const release=actor.motionProgram.segments[0];
    const phase=Math.min(1,world.time/release.duration)*Math.PI/2;
    const stored=world.energyMotion.solution.launchEnergy*Math.cos(phase)**2;
    world.energy+=stored;
    world.energyStages={springEnergy:stored,heat:Math.max(0,world.energyMotion.solution.launchEnergy-stored-kinetic),timing:world.energyMotion.timing};
  }
  world.momentum = { x: px, y: py };
}

// 给渲染和外部核对用的快照。纯拷贝，别在这里算东西
export function snapshotOf(world) {
  //TODO: 字段顺序有测试盯着比对，加字段前想清楚
  const anchors = new Map(world.anchors.map((item) => [item.id, item]));
  const bodies = new Map(world.bodies.map((item) => [item.id, item]));
  // 只输出外部要用的字段。contactKeys 那种内部集合不往外给，给了也没人看
  return {
    time: world.time,
    completed: world.completed === true,
    contacts: world.contacts,
    energy: world.energy,
    momentum: { ...world.momentum },
    ...(world.motionEvents.length ? { motionEvents: world.motionEvents.map(event => ({ ...event })) } : {}),
    ...(world.energyStages?{energyStages:{...world.energyStages}}:{}),
    compounds: world.compounds.map(({ id, memberIds, mass, x, y, vx, vy, angle, formedAt, originX, originY, formationKind }) => ({
      id, memberIds: [...memberIds], mass, x, y, vx, vy, angle: Number(angle ?? 0),
      formedAt, originX, originY, formationKind,
    })),
    bodies: world.bodies.map(({ id, x, y, angle, vx, vy, trackState, lastTrackExit, motionProgram, forceMagnitude, forceAngle,terminalTime }) => ({
      id,
      x,
      y,
      angle: Number(angle ?? 0),
      vx,
      vy,
      ...(terminalTime!=null?{terminalTime}:{}),
      ...(['vertical-bounce','hybrid-process'].includes(motionProgram?.kind) ? { forceMagnitude, forceAngle } : {}),
      trackState: trackState ? {
        supportId: trackState.supportId,
        mode: trackState.mode,
        depthLayer: trackState.depthLayer,
        entryPortalId: trackState.entryPortalId,
        angle: trackState.angle,
        progressRadians: trackState.progressRadians,
        visitedCheckpointIds: [...trackState.visitedCheckpointIds],
      } : null,
      lastTrackExit: lastTrackExit ? { ...lastTrackExit } : null,
    })),
    constraints: [...world.hybridSprings.map(c=>{
      const m=c.hybridSpring,rider=bodies.get(world.hybridProcess.bindings.bodies[m.role]);
      const released=world.hybridProcess.model.phases.some(p=>p.end<=world.time+1e-12&&p.laws[m.role]?.kind==='harmonic');
      return {id:c.id,start:{x:m.originX+m.anchor*world.pixelsPerMeter,y:m.axisY},
       end:{x:released?m.originX+(m.anchor+m.direction*m.restLength)*world.pixelsPerMeter:rider.x,y:m.axisY}};
    }),...world.presentationSprings.map(c=>{
      const carrier=bodies.get(c.startBodyId), rider=bodies.get(c.energyRelease.riderId);
      const start={x:carrier.x+c.startAttachmentOffsetX,y:carrier.y+c.startAttachmentOffsetY};
      const release=rider.motionProgram.segments[0];
      const t=Math.min(1,world.time/release.duration);
      const extension=c.energyRelease.travelPixels*(1-Math.cos(t*Math.PI/2));
      return {id:c.id,start,end:{x:start.x+c.length+extension,y:start.y,energyDriven:true}};
    }), ...world.constraints
      .filter((constraint) => constraint.kind === 'spring')
      .map((constraint) => {
        const { start, end, startMode, endMode } = springNow(constraint, anchors, bodies);
        return {
          id: constraint.id,
          ...(constraint.runtimeDetached?{detached:true}:{}),
          start: springEndSnap(start, startMode),
          end: springEndSnap(end, endMode),
        };
      })],
  };
}

function springEndSnap(endpoint, mode) { // 接触端的 id 要一起带出去，渲染那边要标接触点
  return {
    x: Number(endpoint.x),
    y: Number(endpoint.y),
    contactBodyId: mode === 'contact' ? endpoint.body?.id ?? null : null,
  };
}

//clamp 用得多，放近一点
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizedAngle(angle) { // 统一到 [0, 2π)
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

function canonicalBoxAngle(angle) { // 盒子角度折到 ±90°，转过去看着一样，物理上也一样
  let value = Number(angle)||0;
  while(value>Math.PI/2)value-=Math.PI;
  while(value<=-Math.PI/2)value+=Math.PI;
  return value;
}

function angleWithin(angle, start, end) { // 区间可能跨零，分两种情况
  const normalizedStart = normalizedAngle(start);
  const normalizedEnd = normalizedAngle(end);
  if (normalizedStart <= normalizedEnd) return angle >= normalizedStart && angle <= normalizedEnd;
  return angle >= normalizedStart || angle <= normalizedEnd;
}
