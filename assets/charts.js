/* ============================================================
   charts.js — SVG charts, written in-house
   ------------------------------------------------------------
   No charting library. Three reasons that matter here:
     · the plant network blocks outside scripts, so a CDN chart
       would render as an empty box on the shop floor
     · SVG prints cleanly, which a canvas chart does not
     · it works offline, like the rest of the app

   Every chart returns an SVG string with a viewBox and no fixed
   width, so it scales to whatever column it is dropped into.

   THE THREE THINGS THAT BREAK CHART CODE, handled once here:
     1. no data at all
     2. a single data point (a zero-width axis)
     3. every value zero (divide by zero when scaling)
   niceScale() and the guards in each function cover all three.
   Text is escaped — a machine called "Line <3>" must not be able
   to inject markup into a chart label.
   ============================================================ */

const Charts = (() => {

  /* Colour-blind-safe and distinguishable in greyscale when printed. */
  const PALETTE = ['#0b57d0','#b3261e','#146c2e','#a55b00','#7b1fa2',
                   '#00639b','#c2185b','#5d4037','#455a64','#827717'];
  const C = {
    down:'#b3261e', defect:'#7b1fa2', ok:'#146c2e', line:'#dde3ea',
    ink:'#1f1f1f', muted:'#5f6368', grid:'#eef3fb'
  };

  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };

  /* Round an axis up to a readable maximum — 47 becomes 50, not 47.
     Returns at least 1 so an all-zero series still has a usable axis
     rather than dividing by zero. */
  function niceScale(max){
    const m = num(max);
    if (m <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(m)));
    const norm = m / mag;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  /* Short human numbers on axes: 1500 -> 1.5k */
  function short(n){
    const v = num(n);
    if (Math.abs(v) >= 1000000) return (v/1000000).toFixed(1).replace(/\.0$/,'')+'M';
    if (Math.abs(v) >= 1000) return (v/1000).toFixed(1).replace(/\.0$/,'')+'k';
    return String(Math.round(v * 10) / 10);
  }

  /* Clip a long machine name so it cannot push the plot area off
     the side of the chart. */
  function clip(s, n){
    const t = String(s || '');
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  const empty = (msg, h) =>
    `<div class="chart-empty" style="min-height:${h||120}px">${esc(msg||'Nothing to show yet.')}</div>`;

  const svgOpen = (w,h) =>
    `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img">`;

  /* ---------- horizontal bars ----------
     For ranking things by name — equipment, causes. Horizontal
     because machine names are long and would overlap rotated. */
  function bars(rows, opts = {}){
    const data = (rows||[]).filter(r=>r).slice(0, opts.limit || 10);
    if (!data.length) return empty(opts.emptyText, 140);

    const barH = opts.barH || 26, gap = 10;
    const padL = opts.labelWidth || 150, padR = 64, padT = 8, padB = 24;
    const w = 640;
    const h = padT + padB + data.length * (barH + gap);
    const plotW = w - padL - padR;

    const maxRaw = Math.max(...data.map(d => num(d.value)));
    const max = niceScale(maxRaw);

    let out = svgOpen(w,h);
    out += `<title>${esc(opts.title || 'Bar chart')}</title>`;

    /* gridlines */
    for (let i=0;i<=4;i++){
      const x = padL + (plotW * i / 4);
      out += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${h-padB}" stroke="${C.grid}" stroke-width="1"/>`;
      out += `<text x="${x}" y="${h-padB+15}" fill="${C.muted}" font-size="10"
        text-anchor="middle">${esc(opts.fmt ? opts.fmt(max*i/4) : short(max*i/4))}</text>`;
    }

    data.forEach((d,i)=>{
      const y = padT + i*(barH+gap);
      const v = num(d.value);
      /* max is never 0 thanks to niceScale, so this cannot divide by zero */
      const bw = Math.max(v > 0 ? 2 : 0, (v/max)*plotW);
      const col = d.color || opts.color || PALETTE[i % PALETTE.length];
      out += `<text x="${padL-10}" y="${y+barH/2+4}" fill="${C.ink}" font-size="12"
        text-anchor="end">${esc(clip(d.label, 22))}</text>`;
      out += `<rect x="${padL}" y="${y}" width="${bw}" height="${barH}" rx="4" fill="${col}">
        <title>${esc(d.label)}: ${esc(d.display || short(v))}</title></rect>`;
      out += `<text x="${padL+bw+8}" y="${y+barH/2+4}" fill="${C.muted}" font-size="11.5"
        font-weight="600">${esc(d.display || short(v))}</text>`;
    });
    return out + '</svg>';
  }

  /* ---------- columns over time ----------
     A trend. Optionally two series stacked, so downtime and defect
     minutes can be read together and compared. */
  function columns(rows, opts = {}){
    const data = (rows||[]).filter(r=>r);
    if (!data.length) return empty(opts.emptyText, 160);

    const w = 720, h = 240;
    const padL = 48, padR = 12, padT = 12, padB = 42;
    const plotW = w - padL - padR, plotH = h - padT - padB;

    const stacked = !!opts.stacked;
    const totals = data.map(d => stacked ? num(d.a)+num(d.b) : num(d.value));
    const max = niceScale(Math.max(...totals));

    /* One point would give a zero-width slot; clamp so a single bar
       still renders at a sensible width instead of vanishing. */
    const slot = plotW / Math.max(data.length, 1);
    const bw = Math.max(3, Math.min(48, slot * 0.66));

    let out = svgOpen(w,h);
    out += `<title>${esc(opts.title || 'Trend')}</title>`;

    for (let i=0;i<=4;i++){
      const y = padT + plotH - (plotH*i/4);
      out += `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>`;
      out += `<text x="${padL-8}" y="${y+4}" fill="${C.muted}" font-size="10"
        text-anchor="end">${esc(opts.fmt ? opts.fmt(max*i/4) : short(max*i/4))}</text>`;
    }

    /* Thin out labels so they never collide, however many days. */
    const every = Math.max(1, Math.ceil(data.length / 12));

    data.forEach((d,i)=>{
      const cx = padL + slot*i + slot/2;
      const x = cx - bw/2;
      if (stacked){
        const va = num(d.a), vb = num(d.b);
        const ha = (va/max)*plotH, hb = (vb/max)*plotH;
        if (hb > 0) out += `<rect x="${x}" y="${padT+plotH-hb}" width="${bw}" height="${hb}" rx="2"
          fill="${opts.colorB||C.defect}"><title>${esc(d.label)} — ${esc(opts.nameB||'B')}: ${esc(opts.fmt?opts.fmt(vb):short(vb))}</title></rect>`;
        if (ha > 0) out += `<rect x="${x}" y="${padT+plotH-hb-ha}" width="${bw}" height="${ha}" rx="2"
          fill="${opts.colorA||C.down}"><title>${esc(d.label)} — ${esc(opts.nameA||'A')}: ${esc(opts.fmt?opts.fmt(va):short(va))}</title></rect>`;
      } else {
        const v = num(d.value);
        const bh = (v/max)*plotH;
        if (bh > 0) out += `<rect x="${x}" y="${padT+plotH-bh}" width="${bw}" height="${bh}" rx="2"
          fill="${d.color||opts.color||C.down}"><title>${esc(d.label)}: ${esc(opts.fmt?opts.fmt(v):short(v))}</title></rect>`;
      }
      if (i % every === 0)
        out += `<text x="${cx}" y="${h-padB+16}" fill="${C.muted}" font-size="10"
          text-anchor="middle">${esc(clip(d.label,8))}</text>`;
    });

    out += `<line x1="${padL}" y1="${padT+plotH}" x2="${w-padR}" y2="${padT+plotH}"
      stroke="${C.line}" stroke-width="1"/>`;
    return out + '</svg>';
  }

  /* ---------- pareto ----------
     Bars by size plus a cumulative line. The classic maintenance
     chart: it shows how few causes make up most of the loss. */
  function pareto(rows, opts = {}){
    const data = (rows||[]).filter(r=>r).slice(0, opts.limit || 8);
    if (!data.length) return empty(opts.emptyText, 200);

    const w = 720, h = 280;
    const padL = 52, padR = 46, padT = 14, padB = 76;
    const plotW = w - padL - padR, plotH = h - padT - padB;

    const total = data.reduce((s,d)=>s+num(d.value),0);
    const max = niceScale(Math.max(...data.map(d=>num(d.value))));
    const slot = plotW / Math.max(data.length,1);
    const bw = Math.max(6, Math.min(60, slot*0.6));

    let out = svgOpen(w,h);
    out += `<title>${esc(opts.title || 'Pareto')}</title>`;

    for (let i=0;i<=4;i++){
      const y = padT + plotH - (plotH*i/4);
      out += `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="${C.grid}"/>`;
      out += `<text x="${padL-8}" y="${y+4}" fill="${C.muted}" font-size="10"
        text-anchor="end">${esc(opts.fmt?opts.fmt(max*i/4):short(max*i/4))}</text>`;
      out += `<text x="${w-padR+8}" y="${y+4}" fill="${C.muted}" font-size="10">${i*25}%</text>`;
    }

    let run = 0;
    const pts = [];
    data.forEach((d,i)=>{
      const cx = padL + slot*i + slot/2;
      const v = num(d.value);
      const bh = (v/max)*plotH;
      out += `<rect x="${cx-bw/2}" y="${padT+plotH-bh}" width="${bw}" height="${bh}" rx="3"
        fill="${d.color||PALETTE[i%PALETTE.length]}">
        <title>${esc(d.label)}: ${esc(d.display||short(v))}</title></rect>`;
      run += v;
      /* total can be 0 if every value is 0 — guard it */
      const cum = total > 0 ? run/total : 0;
      pts.push([cx, padT + plotH - cum*plotH]);
      /* Two lines of label so long cause names stay readable. */
      const words = String(d.label||'').split(' ');
      const l1 = clip(words.slice(0, Math.ceil(words.length/2)).join(' '), 14);
      const l2 = clip(words.slice(Math.ceil(words.length/2)).join(' '), 14);
      out += `<text x="${cx}" y="${h-padB+16}" fill="${C.ink}" font-size="10"
        text-anchor="middle">${esc(l1)}</text>`;
      if (l2) out += `<text x="${cx}" y="${h-padB+28}" fill="${C.ink}" font-size="10"
        text-anchor="middle">${esc(l2)}</text>`;
      out += `<text x="${cx}" y="${h-padB+42}" fill="${C.muted}" font-size="10"
        text-anchor="middle" font-weight="600">${esc(d.display||short(v))}</text>`;
    });

    if (pts.length > 1){
      out += `<polyline fill="none" stroke="${C.ink}" stroke-width="2"
        points="${pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}"/>`;
    }
    pts.forEach(p=>{
      out += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5"
        fill="#fff" stroke="${C.ink}" stroke-width="2"/>`;
    });

    out += `<line x1="${padL}" y1="${padT+plotH}" x2="${w-padR}" y2="${padT+plotH}" stroke="${C.line}"/>`;
    return out + '</svg>';
  }

  /* ---------- donut ----------
     A split, not a trend. Kept to a handful of slices because more
     than that is unreadable at any size. */
  function donut(rows, opts = {}){
    const data = (rows||[]).filter(r=>r && num(r.value) > 0);
    const total = data.reduce((s,d)=>s+num(d.value),0);
    if (!data.length || total <= 0) return empty(opts.emptyText, 160);

    const size = 200, r = 78, ir = 48, cx = size/2, cy = size/2;
    let out = svgOpen(size, size);
    out += `<title>${esc(opts.title||'Split')}</title>`;

    /* A single slice would make the arc maths degenerate — draw it as
       a ring instead, which is what it actually is. */
    if (data.length === 1){
      out += `<circle cx="${cx}" cy="${cy}" r="${(r+ir)/2}" fill="none"
        stroke="${data[0].color||PALETTE[0]}" stroke-width="${r-ir}">
        <title>${esc(data[0].label)}: 100%</title></circle>`;
    } else {
      let a0 = -Math.PI/2;
      data.forEach((d,i)=>{
        const frac = num(d.value)/total;
        const a1 = a0 + frac*Math.PI*2;
        const big = frac > 0.5 ? 1 : 0;
        const p = (ang,rad)=>[cx+Math.cos(ang)*rad, cy+Math.sin(ang)*rad];
        const [x0,y0]=p(a0,r), [x1,y1]=p(a1,r), [x2,y2]=p(a1,ir), [x3,y3]=p(a0,ir);
        out += `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)}
          A${r} ${r} 0 ${big} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}
          L${x2.toFixed(2)} ${y2.toFixed(2)}
          A${ir} ${ir} 0 ${big} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z"
          fill="${d.color||PALETTE[i%PALETTE.length]}">
          <title>${esc(d.label)}: ${esc(d.display||short(d.value))} (${Math.round(frac*100)}%)</title></path>`;
        a0 = a1;
      });
    }
    out += `<text x="${cx}" y="${cy-2}" text-anchor="middle" font-size="20"
      font-weight="600" fill="${C.ink}">${esc(opts.centre||short(total))}</text>`;
    if (opts.centreSub)
      out += `<text x="${cx}" y="${cy+16}" text-anchor="middle" font-size="10"
        fill="${C.muted}">${esc(opts.centreSub)}</text>`;
    return out + '</svg>';
  }

  /* ---------- heatmap: day of week × hour ----------
     The one that tends to surprise people. Production loss plotted
     by when it happened exposes patterns a total never shows —
     the Monday start-up hour, the shift-handover gap, the cell that
     only fails on nights. */
  function heatmap(grid, opts = {}){
    const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const g = grid || [];
    let max = 0;
    g.forEach(row => (row||[]).forEach(v => { if (num(v) > max) max = num(v); }));
    if (max <= 0) return empty(opts.emptyText || 'No production loss recorded in this period.', 180);

    const cell = 22, gap = 2;
    const padL = 42, padT = 26, padB = 14, padR = 10;
    const w = padL + padR + 24*(cell+gap);
    const h = padT + padB + 7*(cell+gap);

    let out = svgOpen(w,h);
    out += `<title>${esc(opts.title||'When it happens')}</title>`;

    for (let hr=0; hr<24; hr+=2){
      out += `<text x="${padL + hr*(cell+gap) + cell/2}" y="${padT-8}"
        fill="${C.muted}" font-size="9.5" text-anchor="middle">${hr}</text>`;
    }
    DAYS.forEach((d,i)=>{
      out += `<text x="${padL-8}" y="${padT + i*(cell+gap) + cell/2 + 4}"
        fill="${C.muted}" font-size="10" text-anchor="end">${d}</text>`;
    });

    for (let d=0; d<7; d++){
      for (let hr=0; hr<24; hr++){
        const v = num((g[d]||[])[hr]);
        /* max is > 0 here, so this ratio is safe */
        const t = v / max;
        /* Pale blue through to deep red — empty cells stay visible as
           a faint grid so the shape of the week is still readable. */
        const fill = v <= 0 ? '#f4f7fb'
          : t < 0.25 ? '#ffe0b2'
          : t < 0.5  ? '#ffb74d'
          : t < 0.75 ? '#e57373'
          : '#b3261e';
        out += `<rect x="${padL + hr*(cell+gap)}" y="${padT + d*(cell+gap)}"
          width="${cell}" height="${cell}" rx="3" fill="${fill}">
          <title>${DAYS[d]} ${hr}:00 — ${esc(opts.fmt?opts.fmt(v):short(v))}</title></rect>`;
      }
    }
    return out + '</svg>';
  }

  /* A legend that matches whatever colours the chart used. */
  function legend(items){
    const list = (items||[]).filter(i=>i);
    if (!list.length) return '';
    return `<div class="chart-legend">${list.map(i=>
      `<span><i style="background:${i.color||C.down}"></i>${esc(i.label)}</span>`).join('')}</div>`;
  }

  return { PALETTE, C, bars, columns, pareto, donut, heatmap, legend, niceScale, short, esc };
})();

if (typeof module !== 'undefined') module.exports = Charts;
