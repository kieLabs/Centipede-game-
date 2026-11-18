import { segmentsForMass, clamp, angleLerp, wormRadiusForMass } from './logic.js';

export function createWorm({x,y,angle=0,name='Centipede',skin,player=false,mass=40,ai=0}) {
  const worm = {id:Math.random().toString(36).slice(2),x,y,angle,targetAngle:angle,name,skin,player,mass,ai,
    speed:player?150:108+Math.random()*24,baseSpeed:player?150:108+Math.random()*24,r:wormRadiusForMass(mass,0),alive:true,boosting:false,
    trail:[],trailDistance:0,score:Math.round(mass*2),coins:0,kills:0,food:0,created:performance.now(),respawnAt:0,
    powerups:{},shieldHits:0,think:0,personality:Math.random(),lastDrop:0,spawnProtectedUntil:0};
  for(let i=0;i<Math.max(30,segmentsForMass(mass,0)*6);i++) worm.trail.push({x:x-Math.cos(angle)*i*2.2,y:y-Math.sin(angle)*i*2.2});
  return worm;
}
export function updateWormTrail(worm, dt, targetAngle, world, boost=false) {
  // Keep collision radius synchronized with growth for both the player and AI centipedes.
  worm.r = wormRadiusForMass(worm.mass, worm.food || 0);
  worm.boosting = boost;
  const turn = clamp(dt*4.3,0,1);
  worm.angle = angleLerp(worm.angle,targetAngle,turn);
  const activeSpeed = worm.baseSpeed * (boost?1.75:1) * (worm.powerups.speed?1.45:1) * (worm.powerups.super?2.05:1);
  worm.speed = activeSpeed;
  const step = activeSpeed*dt;
  worm.x += Math.cos(worm.angle)*step;
  worm.y += Math.sin(worm.angle)*step;
  worm.x = clamp(worm.x, 24, world.width-24);
  worm.y = clamp(worm.y, 24, world.height-24);
  worm.trail.unshift({x:worm.x,y:worm.y});
  const desired = segmentsForMass(worm.mass, worm.food || 0);
  const keep = Math.max(40, desired*5+20);
  if(worm.trail.length>keep) worm.trail.length=keep;
}
export function bodyPoints(worm) {
  const count = segmentsForMass(worm.mass, worm.food || 0);
  const points=[];
  for(let i=count-1;i>=1;i--) {
    const p=worm.trail[Math.min(worm.trail.length-1,Math.round(i*5))];
    if(p) points.push(p);
  }
  return points;
}
function skinColor(skin, index, count, time) {
  if(skin.pattern==='rainbow') return `hsl(${(time*.05+index*13)%360} 88% 62%)`;
  if(skin.pattern==='galaxy') return index%4===0?'#fff1be':(index%2?skin.a:skin.b);
  if(skin.pattern==='glow') return index%3===0?'#fff4a3':(index%2?skin.a:skin.b);
  if(skin.pattern==='stripe') return index%3===0?skin.b:skin.a;
  if(skin.pattern==='spots') return index%4===0?skin.b:skin.a;
  return index%5===0?skin.b:skin.a;
}
export function drawWorm(ctx,worm,skin,time,zoom=1) {
  const count=segmentsForMass(worm.mass, worm.food || 0), spacing=5, radius=worm.r=wormRadiusForMass(worm.mass, worm.food || 0);
  const points=[];
  for(let i=count-1;i>=0;i--) points.push(worm.trail[Math.min(worm.trail.length-1,Math.round(i*spacing))]||{x:worm.x,y:worm.y});
  ctx.save();
  if(worm.player && Object.values(worm.powerups).some(Boolean)) {ctx.shadowBlur=18;ctx.shadowColor='#fff1a6';}

  const waveSpeed = (worm.boosting || worm.speed > 175) ? 0.025 : 0.014;
  const legStride = count > 90 ? 2 : 1;

  // 1. Draw Tail Cerci (Rear Pincers) on the tail segment
  if(points.length >= 2) {
    const tail = points[0];
    const next = points[1];
    const tailAngle = Math.atan2(tail.y - next.y, tail.x - next.x);
    const tailR = radius * 0.74;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for(const side of [-1, 1]) {
      const sway = Math.sin(time * 0.008 + side) * 0.14;
      const a1 = tailAngle + side * 0.42 + sway;
      const a2 = tailAngle + side * 0.18 + sway;
      const mx = tail.x + Math.cos(a1) * (tailR * 1.15);
      const my = tail.y + Math.sin(a1) * (tailR * 1.15);
      const tx = mx + Math.cos(a2) * (tailR * 0.85);
      const ty = my + Math.sin(a2) * (tailR * 0.85);
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(mx, my);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = skin.b || '#163c35';
      ctx.lineWidth = Math.max(2, radius * 0.22);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(1.6, radius * 0.13), 0, Math.PI * 2);
      ctx.fillStyle = '#ffe16e';
      ctx.fill();
    }
    ctx.restore();
  }

  // 2. Draw Jointed Waving Centipede Legs under the chitin body segments
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for(let i=1; i<points.length-1; i+=legStride) {
    const p = points[i];
    const next = points[Math.min(points.length-1, i+1)];
    const prev = points[Math.max(0, i-1)];
    const segAngle = Math.atan2(next.y - prev.y, next.x - prev.x);
    const pct = i / Math.max(1, points.length - 1);
    const r = radius * (.74 + .26 * Math.sin(pct * Math.PI * .65));
    const phase = time * waveSpeed - i * 0.65;

    for(const side of [-1, 1]) {
      const swing = Math.sin(phase + (side === 1 ? 0 : Math.PI * 0.35)) * 0.44;
      const perp = segAngle + side * (Math.PI / 2) + swing * 0.55;
      const kneeDist = r * 1.18;
      const footDist = r * 0.62;
      const kx = p.x + Math.cos(perp) * kneeDist;
      const ky = p.y + Math.sin(perp) * kneeDist;
      const footAngle = perp - side * 0.52 + swing * 0.35;
      const fx = kx + Math.cos(footAngle) * footDist;
      const fy = ky + Math.sin(footAngle) * footDist;

      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(perp) * (r * 0.45), p.y + Math.sin(perp) * (r * 0.45));
      ctx.lineTo(kx, ky);
      ctx.lineTo(fx, fy);
      ctx.strokeStyle = 'rgba(20, 42, 34, 0.72)';
      ctx.lineWidth = Math.max(1.8, r * 0.22);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(fx, fy, Math.max(1.4, r * 0.13), 0, Math.PI * 2);
      ctx.fillStyle = skin.b || '#ffe16e';
      ctx.fill();
    }
  }
  ctx.restore();

  // 3. Draw Overlapping Chitin Armor Plates (Body Segments)
  for(let i=0;i<points.length;i++) {
    const p=points[i];
    const next=points[Math.min(points.length-1, i+1)];
    const prev=points[Math.max(0, i-1)];
    const segAngle = Math.atan2(next.y - prev.y, next.x - prev.x);
    const pct=i/Math.max(1,points.length-1);
    const r=radius*(.74+.26*Math.sin(pct*Math.PI*.65));

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(segAngle);

    // Chitin plate carapace (slightly wider across the dorsal ridge)
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.92, r * 1.06, 0, 0, Math.PI * 2);
    ctx.fillStyle=skinColor(skin,i,count,time);
    ctx.fill();
    ctx.lineWidth=2.2;
    ctx.strokeStyle='rgba(25,48,38,.36)';
    ctx.stroke();

    // Inner dorsal ridge plate line & specular shine
    ctx.beginPath();
    ctx.arc(-r*.22, -r*.32, r*.3, 0, Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,.24)';
    ctx.fill();

    if(skin.pattern==='spots'&&i%4===0){
      ctx.beginPath();
      ctx.arc(r*.18, 0, r*.22, 0, Math.PI*2);
      ctx.fillStyle='rgba(65,42,25,.45)';
      ctx.fill();
    }
    ctx.restore();
  }

  // 4. Draw Centipede Head, Animated Mandibles (Pincers), Antennae & Eyes
  ctx.save();
  ctx.translate(worm.x,worm.y);
  ctx.rotate(worm.angle);

  const biteSnap = Math.sin(time * 0.016) * 0.16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Animated Front Mandibles (Pincers)
  for(const side of [-1, 1]) {
    const mBaseAngle = side * (0.46 - biteSnap * 0.45);
    const mTipAngle = side * (0.14 - biteSnap * 0.35);
    const mx1 = Math.cos(mBaseAngle) * (radius * 1.28);
    const my1 = Math.sin(mBaseAngle) * (radius * 1.28);
    const mx2 = mx1 + Math.cos(mTipAngle) * (radius * 0.55);
    const my2 = my1 + Math.sin(mTipAngle) * (radius * 0.55);

    ctx.beginPath();
    ctx.moveTo(radius * 0.55, side * radius * 0.36);
    ctx.lineTo(mx1, my1);
    ctx.lineTo(mx2, my2);
    ctx.strokeStyle = '#fff3b0';
    ctx.lineWidth = Math.max(2.2, radius * 0.22);
    ctx.stroke();
  }

  // Sweeping Sensory Antennae
  for(const side of [-1, 1]) {
    const aWave = Math.sin(time * 0.01 + side * 1.4) * 0.14;
    const a1 = side * 0.52 + aWave;
    const a2 = side * 0.72 + aWave * 1.3;
    const ax1 = Math.cos(a1) * (radius * 1.45);
    const ay1 = Math.sin(a1) * (radius * 1.45);
    const ax2 = ax1 + Math.cos(a2) * (radius * 0.72);
    const ay2 = ay1 + Math.sin(a2) * (radius * 0.72);

    ctx.beginPath();
    ctx.moveTo(radius * 0.65, side * radius * 0.38);
    ctx.quadraticCurveTo(ax1, ay1, ax2, ay2);
    ctx.strokeStyle = skin.b || '#ffdc60';
    ctx.lineWidth = Math.max(1.6, radius * 0.15);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(ax2, ay2, Math.max(1.8, radius * 0.15), 0, Math.PI * 2);
    ctx.fillStyle = '#ff7b54';
    ctx.fill();
  }

  // Armored Head Shield
  ctx.beginPath();
  ctx.ellipse(1,0,radius*1.12,radius*1.02,0,0,Math.PI*2);
  ctx.fillStyle=skin.a;
  ctx.fill();
  ctx.lineWidth=2.2;
  ctx.strokeStyle='rgba(25,48,38,.38)';
  ctx.stroke();

  // Expressive Eyes
  for(const ey of [-1,1]) {
    ctx.beginPath();ctx.arc(5,ey*6,4.2,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();
    ctx.beginPath();ctx.arc(6.8,ey*6,2.0,0,Math.PI*2);ctx.fillStyle='#1f2c33';ctx.fill();
  }
  ctx.restore();
  ctx.restore();

  if(worm.name) {
    ctx.save();
    const label=String(worm.name).replace(/[<>]/g,'').slice(0,18);
    ctx.font=`800 ${worm.player?13:12}px system-ui`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    const labelWidth=ctx.measureText(label).width+14;
    const labelY=worm.y-radius-23;
    ctx.fillStyle=worm.player?'rgba(15,82,54,.88)':'rgba(20,35,44,.78)';
    ctx.beginPath();ctx.roundRect(worm.x-labelWidth/2,labelY-9,labelWidth,18,8);ctx.fill();
    ctx.fillStyle='#fff';ctx.fillText(label,worm.x,labelY);
    ctx.restore();
  }
}
