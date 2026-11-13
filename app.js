// A.Flow — data/*.json 을 읽어 화면을 그린다. 라이브러리 없이 SVG 로 직접 그린다.
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const nf = (d) => new Intl.NumberFormat('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt = (v, d = 2) => (v == null || Number.isNaN(+v) ? '—' : nf(d).format(+v));
  const signed = (v, d = 2, unit = '') => (v == null || Number.isNaN(+v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + nf(d).format(Math.abs(v)) + unit);
  // 억 원 단위 금액: 1조(=1만 억) 이상이면 조로 줄인다
  const won = (v, sign = false) => {
    if (v == null || Number.isNaN(+v)) return '—';
    const a = Math.abs(v), s = sign ? (v > 0 ? '+' : v < 0 ? '−' : '') : '';
    return a >= 10000 ? `${s}${nf(1).format(a / 10000)}조` : `${s}${nf(0).format(a)}억`;
  };
  const tone = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const clamp = (x) => Math.max(0, Math.min(100, x));
  const el = (tag, attrs = {}, text) => {
    const n = tag.startsWith('svg:') ? document.createElementNS(NS, tag.slice(4)) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  const parseDay = (s) => { s = String(s); return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); };
  const dayText = (d) => `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;

  // 지표 순서와 표시 방법
  const ORDER = [
    { key: 'KOSPI', grp: '한국 · 유가증권시장', d: 2, kr: true },
    { key: 'KOSDAQ', grp: '한국 · 코스닥시장', d: 2, kr: true },
    { key: 'K200F', grp: '한국 · 주간 거래 · 20분 지연', d: 2, kr: true },
    { key: 'N225', grp: '일본', d: 2 },
    { key: 'SPX', grp: '미국', d: 2 },
    { key: 'IXIC', grp: '미국', d: 2 },
    { key: 'NQ', grp: '미국 · 10분 지연', d: 2 },
    { key: 'USDKRW', grp: '환율 · 하나은행 고시', d: 2, unit: '원' },
    { key: 'US10Y', grp: '금리', d: 3, unit: '%', bp: true },
    { key: 'WTI', grp: '원자재 · 10분 지연', d: 2, unit: '달러' },
    { key: 'GOLD', grp: '원자재 · 10분 지연', d: 1, unit: '달러' },
  ];

  // 레이더 네 축: 끝값은 이 사이트가 정한 참고선 (index.html "레이더 읽는 법"과 같은 값)
  const AXES = [
    { id: 'rate', name: '금리', score: (s) => clamp(((s.US10Y - 3.5) / 2.0) * 100), text: (s) => `미 10년물 ${fmt(s.US10Y, 2)}%` },
    { id: 'fx', name: '환율', score: (s) => clamp(((s.USDKRW - 1200) / 300) * 100), text: (s) => `원/달러 ${fmt(s.USDKRW, 0)}원` },
    { id: 'dd', name: '고점 대비', score: (s) => clamp((-s.dd / 50) * 100), text: (s) => `52주 고점보다 ${fmt(Math.abs(s.dd), 1)}% 아래` },
    { id: 'flow', name: '수급', score: (s) => clamp(50 - (s.flowFI / 5000) * 50), text: (s) => `외국인+기관 ${signed(s.flowFI, 0)}억 원` },
  ];

  const load = (name) => fetch(`data/${name}.json?t=${Math.floor(Date.now() / 300000)}`, { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`${name}.json 을 불러오지 못했습니다 (${r.status})`); return r.json(); });

  // 새로고침 버튼: 내 PC 서버(로컬서버.ps1)에 새 시세를 받아 달라고 한 뒤 화면을 다시 읽는다.
  // 그런 서버가 없는 주소(예: GitHub Pages)에서는 저장된 최신 파일만 다시 읽는다.
  const toast = (text, bad = false, ms = 5000) => {
    const t = $('#toast'); t.textContent = text; t.classList.toggle('bad', bad); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  };
  const NOTE = 'aflow-refresh-note';
  try { const n = sessionStorage.getItem(NOTE); if (n) { sessionStorage.removeItem(NOTE); setTimeout(() => toast(n), 300); } } catch (e) { /* 저장소를 못 쓰면 안내만 생략 */ }
  const btn = $('#refresh');
  btn.addEventListener('click', async () => {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true'); btn.querySelector('span').textContent = '받는 중…';
    const done = () => { btn.removeAttribute('aria-busy'); btn.querySelector('span').textContent = '새로고침'; };
    const reloadWith = (note) => { try { sessionStorage.setItem(NOTE, note); } catch (e) { /* 무시 */ } location.reload(); };
    try {
      const r = await fetch('api/refresh', { method: 'POST', headers: { 'X-AFlow': '1' } });
      if (r.status === 404 || r.status === 405) { reloadWith('이 주소에서는 새 시세를 직접 받을 수 없어, 저장된 최신 데이터를 다시 불러왔습니다.'); return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { done(); toast('새 시세를 받지 못했습니다. 잠시 뒤 다시 눌러 주세요.', true, 8000); return; }
      const m = /\((\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)/.exec(j.message || '');
      reloadWith(m ? `${m[1]} 기준 시세로 새로 받았습니다.` : '새 시세를 받았습니다.');
    } catch (e) {
      done(); toast('시세 서버에 연결하지 못했습니다. 이 PC에서 A.Flow 미리보기가 켜져 있는지 확인해 주세요.', true, 8000);
    }
  });

  const optional = (name) => load(name).catch(() => null);   // 없어도 나머지 화면은 그린다
  Promise.all([...['snapshot', 'history', 'kospi', 'journal'].map(load), optional('flows'), optional('top'), optional('investors'), optional('night')])
    .then(([snap, hist, kospi, journal, flows, top, investors, night]) => { render(snap, hist, kospi, journal, investors, night); renderFlows(flows); renderTop(top); })
    .catch((e) => {
      $('#lead').textContent = '시세 파일을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.';
      const box = el('p', { class: 'error' }, e.message);
      $('#lead').after(box);
    });

  function render(snap, hist, kospi, journal, investors, night) {
    const by = Object.fromEntries(snap.rows.map((r) => [r.key, r]));
    const series = (key) => hist.rows.filter((r) => r.key === key && r.close != null)
      .map((r) => ({ date: parseDay(r.date), close: +r.close })).sort((a, b) => a.date - b.date);
    const k = kospi.rows[0] || {};
    const stampMeta = (snap.meta || []).find((m) => m.label && m.label.startsWith('수집 시각'));
    $('#stamp').textContent = stampMeta ? stampMeta.value : '—';

    const state = {
      US10Y: by.US10Y?.value, USDKRW: by.USDKRW?.value,
      dd: k.high52 && by.KOSPI ? (by.KOSPI.value / k.high52 - 1) * 100 : null,
      flowFI: (k.flow_foreign ?? 0) + (k.flow_institution ?? 0),
    };
    const scores = AXES.map((a) => ({ ...a, v: a.score(state), t: a.text(state) }));
    const top = scores.reduce((m, a) => (a.v > m.v ? a : m), scores[0]);

    // 첫 화면 문장
    $('#top-axis').textContent = `'${top.name}'`;
    const lead = $('#lead');
    lead.replaceChildren();
    const kp = by.KOSPI;
    const part = (label, value, cls) => { const b = el('b', cls ? { class: cls } : {}, value); lead.append(label, b); };
    if (kp) {
      part('코스피는 ', fmt(kp.value), null);
      lead.append(' (');
      part('', signed(kp.pct, 2, '%'), tone(kp.pct));
      lead.append(')로, 52주 고점보다 ');
      part('', `${fmt(Math.abs(state.dd), 1)}%`, null);
      lead.append(' 아래에 있습니다. 미 국채 10년물은 ');
      part('', `${fmt(state.US10Y, 3)}%`, null);
      lead.append(', 원/달러 환율은 ');
      part('', `${fmt(state.USDKRW, 1)}원`, null);
      lead.append('입니다.');
    }

    // 네 축 목록
    $('#axes').replaceChildren(...scores.map((a) => {
      const li = el('li', { class: a === top ? 'hot' : null });
      const kk = el('span', { class: 'k' }); kk.append(a.name, el('i', {}, `${Math.round(a.v)}점`));
      const m = el('div', { class: 'meter', 'aria-hidden': 'true' }); const bar = el('span'); bar.style.width = `${a.v}%`; m.append(bar);
      li.append(kk, el('b', {}, a.t), m);
      return li;
    }));
    drawScope(scores);

    // 지표 카드 (국내 시장 카드에는 오늘 매매 주체를 붙인다)
    const inv = Object.fromEntries((investors?.rows || []).map((r) => [r.key, r]));
    const makeTile = (o) => {
      const r = by[o.key];
      const s = series(o.key);
      const base = s[s.length - 21];
      const last = s[s.length - 1];
      const d20 = base && last ? (o.bp ? (last.close - base.close) * 100 : (last.close / base.close - 1) * 100) : null;
      const dayChg = o.bp ? r.chg * 100 : r.pct;
      const card = el('article', { class: 'tile', id: `t-${o.key}` });
      const topRow = el('div', { class: 'top' });
      topRow.append(el('span', { class: 'name' }, r.name), el('span', { class: `chg ${tone(dayChg)}` }, o.bp ? signed(dayChg, 1, 'bp') : signed(dayChg, 2, '%')));
      const val = el('div', { class: 'val' }, fmt(r.value, o.d));
      if (o.unit) val.append(el('small', {}, o.unit));
      const sp = el('div', { class: 'spark' });
      const foot = el('div', { class: 'tfoot' });
      const f20 = el('span'); f20.append('20거래일 ', el('b', { class: tone(d20) }, o.bp ? signed(d20, 1, 'bp') : signed(d20, 2, '%')));
      foot.append(f20, el('span', {}, `기준 ${r.time}`));
      card.append(el('span', { class: 'grp' }, o.grp), topRow, val, sp, foot);
      const iv = inv[o.key];
      if (o.kr && iv) {
        const box = el('div', { class: 'inv', 'aria-label': `${r.name} 오늘 매매 주체` });
        [['개인', iv.personal], ['외국인', iv.foreign], ['기관', iv.institution]].forEach(([who, v]) => {
          const d = el('div'); d.append(el('span', {}, who), el('b', { class: tone(v) }, won(v, true))); box.append(d);
        });
        const dt = parseDay(iv.date);
        box.append(el('span', { class: 'inv-unit' }, `${dayText(dt)} 순매수 · 억 원`));
        card.append(box);
      }
      card._draw = () => drawSpark(sp, s, o.d, r.name);
      return card;
    };
    const shown = ORDER.filter((o) => by[o.key]);
    $('#tiles-kr').replaceChildren(...shown.filter((o) => o.kr).map(makeTile));
    // 야간선물 (esignal 추정가, Claude 가 브라우저로 읽어 저장한 값)
    const n = night?.rows?.[0];
    if (n) {
      const card = el('article', { class: 'tile', id: 't-K200N' });
      const topRow = el('div', { class: 'top' });
      topRow.append(el('span', { class: 'name' }, n.name), el('span', { class: `chg ${tone(n.pct)}` }, signed(n.pct, 2, '%')));
      const facts = el('div', { class: 'night-facts' });
      [['시가', n.open], ['고가', n.high], ['저가', n.low], ['주간 종가', n.day_close]].forEach(([a, v]) => {
        if (v == null) return; const s = el('div'); s.append(el('span', {}, a), el('b', {}, fmt(v))); facts.append(s);
      });
      const foot = el('div', { class: 'tfoot' });
      foot.append(el('span', {}, `주간 종가 대비 ${signed(n.chg, 2)}`), el('span', {}, `기준 ${n.time}`));
      const note = el('div', { class: 'inv' });
      note.append(el('span', { class: 'inv-unit' }, 'esignal.co.kr 추정가로 실제 시세와 다를 수 있습니다. 야간 매매 주체 자료는 없습니다.'));
      card.append(el('span', { class: 'grp' }, '한국 · 야간 거래(18:00~06:00)'), topRow, el('div', { class: 'val' }, fmt(n.value)), facts, foot, note);
      card._draw = () => {};
      $('#tiles-kr').append(card);
    }
    $('#tiles').replaceChildren(...shown.filter((o) => !o.kr).map(makeTile));
    document.querySelectorAll('.tile').forEach((c) => c._draw());

    // 코스피
    const w = series('KOSPI_W');
    const facts = [
      ['지금', fmt(kp?.value)],
      ['52주 최고', fmt(k.high52)],
      ['외국인 순매수 (억 원)', signed(k.flow_foreign, 0), tone(k.flow_foreign)],
      ['기관 순매수 (억 원)', signed(k.flow_institution, 0), tone(k.flow_institution)],
      ['개인 순매수 (억 원)', signed(k.flow_personal, 0), tone(k.flow_personal)],
      ['오른 종목 · 내린 종목', `${fmt(k.up, 0)} · ${fmt(k.down, 0)}`],
    ];
    $('#kfacts').replaceChildren(...facts.map(([a, b, c]) => { const f = el('div', { class: 'fact' }); f.append(el('span', {}, a), el('b', c ? { class: c } : {}, b)); return f; }));
    const drawK = () => drawKospi($('#kchart'), w, k.high52);
    drawK();

    // 일지
    const rows = (journal.rows || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    $('#journal').replaceChildren(...(rows.length ? rows.map((r) => {
      const li = el('li'); const body = el('div');
      body.append(el('h3', {}, r.title), el('p', {}, r.text));
      li.append(el('time', {}, r.at), body);
      return li;
    }) : [el('li', { class: 'empty' }, '아직 적은 일지가 없습니다.')]));

    let rt;
    let lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(rt);
      rt = setTimeout(() => { document.querySelectorAll('.tile').forEach((c) => c._draw()); drawK(); }, 150);
    });
  }

  // 돈의 흐름: 2년 누적 선 그래프 두 개 + 최근 20거래일 막대
  function renderFlows(flows) {
    const box = $('#flows'), lead = $('#flow-lead');
    const all = (flows?.rows || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!all.length) { lead.textContent = '투자자별 순매수 데이터를 아직 받지 못했습니다.'; box.replaceChildren(); return; }
    const WHO = [['foreign', '외국인'], ['institution', '기관'], ['personal', '개인']];
    const COLOR = { foreign: 'var(--s-foreign)', institution: 'var(--s-inst)', personal: 'var(--s-person)' };
    const word = (v) => (v >= 0 ? '순매수' : '순매도');
    const dates = all.map((r) => parseDay(r.date));
    const cum = {};
    WHO.forEach(([k]) => { let s = 0; cum[k] = all.map((r) => (s += (+r[k] || 0))); });
    const last = all.length - 1;
    const years = ((dates[last] - dates[0]) / (365.25 * 864e5)).toFixed(1).replace(/\.0$/, '');

    lead.replaceChildren(`${dayText(dates[0])}부터 ${dayText(dates[last])}까지 ${all.length}거래일(약 ${years}년) 동안 `);
    WHO.forEach(([k, name], i) => {
      const v = cum[k][last];
      lead.append(`${name} `, el('b', { class: tone(v) }, `${won(v)} 원 ${word(v)}`), i < 2 ? ', ' : '');
    });
    lead.append('입니다.');
    $('#flow-all-range').textContent = `${dayText(dates[0])} ~ ${dayText(dates[last])} · 조 원`;

    // 범례: 누적과 오늘 하루
    $('#flow-legend').replaceChildren(...WHO.map(([k, name]) => {
      const s = el('span'); const i = el('i'); i.style.background = COLOR[k];
      s.append(i, `${name} `, el('b', {}, `${won(cum[k][last], true)}`), el('small', {}, ` (오늘 ${won(+all[last][k], true)})`));
      return s;
    }));
    // 외국인 상자: 누적 / 오늘 / 전일
    const fb = $('#fbox'); fb.replaceChildren();
    [['누적', cum.foreign[last]], ['오늘', +all[last].foreign], ['전일', last > 0 ? +all[last - 1].foreign : null]].forEach(([a, v]) => {
      const s = el('span'); s.append(`${a} `, el('b', { class: tone(v) }, won(v, true))); fb.append(s);
    });
    // 20일 이동평균 (누적값의)
    const ma = cum.foreign.map((_, i) => (i < 19 ? null : cum.foreign.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20));

    const drawAll = () => {
      drawLines($('#flow-all-chart'), dates, WHO.map(([k, name]) => ({ name, color: COLOR[k], values: cum[k] })), '외국인·기관·개인의 최근 2년 코스피 누적 순매수 선 그래프');
      drawLines($('#flow-foreign-chart'), dates, [{ name: '외국인 누적', color: 'var(--s-foreign)', values: cum.foreign }, { name: '20일 평균', color: 'var(--s-ma)', values: ma, ma: true }], '외국인의 최근 2년 코스피 누적 순매수와 20일 평균선');
    };

    const rows = all.slice(-20);
    const sum = (k) => rows.reduce((s, r) => s + (+r[k] || 0), 0);
    const maxAbs = Math.max(1, ...rows.flatMap((r) => WHO.map(([k]) => Math.abs(+r[k] || 0))));
    box.replaceChildren(...WHO.map(([k, name]) => {
      const row = el('div', { class: 'flow-row', id: `flow-${k}` });
      const who = el('div', { class: 'who' });
      const today = rows[rows.length - 1];
      const tot = sum(k);
      who.append(el('span', {}, `${name} · 20일 누적`), el('b', { class: tone(tot) }, won(tot, true)), el('small', {}, `오늘 ${won(+today[k], true)}`));
      const bars = el('div', { class: 'bars' });
      row.append(who, bars);
      row._draw = () => drawBars(bars, rows, k, name, maxAbs);
      return row;
    }));
    const draw = () => { drawAll(); box.querySelectorAll('.flow-row').forEach((r) => r._draw()); };
    draw();
    let w0 = window.innerWidth, t;
    window.addEventListener('resize', () => { if (window.innerWidth === w0) return; w0 = window.innerWidth; clearTimeout(t); t = setTimeout(draw, 150); });
  }

  // 여러 줄 선 그래프 (값 단위: 억 원, 축은 조 원으로 표시). 가리키면 그날 모든 선의 값을 보여 준다.
  function drawLines(box, dates, series, label) {
    box.replaceChildren();
    const W = Math.max(280, box.clientWidth), H = W < 480 ? 240 : 280;
    const m = { t: 12, r: 12, b: 26, l: 48 };
    const vals = series.flatMap((s) => s.values.filter((v) => v != null));
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
    const t0 = dates[0], t1 = dates[dates.length - 1];
    const x = (d) => m.l + ((d - t0) / (t1 - t0 || 1)) * (W - m.l - m.r);
    const y = (v) => m.t + ((hi - v) / (hi - lo || 1)) * (H - m.t - m.b);
    const svg = el('svg:svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
    const ax = el('svg:g', { class: 'ax' });
    niceTicks(lo / 1e4, hi / 1e4, W < 480 ? 4 : 6).forEach((jo) => {
      ax.append(el('svg:line', { x1: m.l, x2: W - m.r, y1: y(jo * 1e4), y2: y(jo * 1e4) }));
      ax.append(el('svg:text', { x: m.l - 8, y: y(jo * 1e4) + 4, 'text-anchor': 'end' }, `${nf(0).format(jo)}조`));
    });
    // 가로축: 분기 첫 거래일
    let lastKey = '';
    const every = W < 480 ? 6 : 3;
    dates.forEach((d) => {
      const mo = d.getUTCMonth(), key = `${d.getUTCFullYear()}-${mo}`;
      if (mo % every === 0 && key !== lastKey) {
        lastKey = key;
        const px = x(d);
        if (px > m.l + 14 && px < W - m.r - 14) ax.append(el('svg:text', { x: px, y: H - 8, 'text-anchor': 'middle' }, `${String(d.getUTCFullYear()).slice(2)}.${String(mo + 1).padStart(2, '0')}`));
      }
    });
    svg.append(ax);
    svg.append(el('svg:line', { class: 'ln-zero', x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }));
    series.forEach((s) => {
      let d = '', pen = false;
      s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(dates[i]).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
      const p = el('svg:path', { class: s.ma ? 'ln ma' : 'ln', d }); p.style.stroke = s.color; svg.append(p);
      const lv = s.values[s.values.length - 1];
      if (lv != null && !s.ma) { const c = el('svg:circle', { cx: x(dates[dates.length - 1]), cy: y(lv), r: 3.5 }); c.style.fill = s.color; svg.append(c); }
    });
    // 가리키기
    const guide = el('svg:line', { class: 'k-guide', y1: m.t, y2: H - m.b, visibility: 'hidden' });
    svg.append(guide);
    const pick = (ev) => {
      const b = svg.getBoundingClientRect();
      const mx = ((ev.clientX - b.left) / b.width) * W;
      let i = 0, bd = Infinity;
      dates.forEach((d, j) => { const dd = Math.abs(x(d) - mx); if (dd < bd) { bd = dd; i = j; } });
      const gx = x(dates[i]);
      guide.setAttribute('x1', gx); guide.setAttribute('x2', gx); guide.setAttribute('visibility', 'visible');
      const text = `${dayText(dates[i])}  ` + series.map((s) => `${s.name} ${s.values[i] == null ? '—' : won(s.values[i], true)}`).join(' · ');
      showTip(text, b.left + (gx / W) * b.width + window.scrollX, b.top + window.scrollY + 20);
    };
    svg.addEventListener('pointermove', pick); svg.addEventListener('pointerdown', pick);
    svg.addEventListener('pointerleave', () => { guide.setAttribute('visibility', 'hidden'); hideTip(); });
    box.append(svg);
  }

  function drawBars(box, rows, k, name, maxAbs) {
    box.replaceChildren();
    const W = Math.max(240, box.clientWidth), H = 92, top = 6, bottom = 18;
    const mid = top + (H - top - bottom) / 2, half = (H - top - bottom) / 2;
    const step = W / rows.length, bw = Math.max(3, Math.min(22, step * 0.62));
    const svg = el('svg:svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${name}의 최근 ${rows.length}거래일 코스피 순매수 막대` });
    svg.append(el('svg:line', { class: 'bar-zero', x1: 0, x2: W, y1: mid, y2: mid }));
    rows.forEach((r, i) => {
      const v = +r[k] || 0, h = (Math.abs(v) / maxAbs) * half;
      const x = i * step + (step - bw) / 2;
      svg.append(el('svg:rect', { class: v >= 0 ? 'bar-up' : 'bar-down', x, y: v >= 0 ? mid - h : mid, width: bw, height: Math.max(1, h), rx: 1.5 }));
      const hit = el('svg:rect', { class: 'bar-hit', x: i * step, y: 0, width: step, height: H - bottom });
      const d = parseDay(r.date);
      const show = (ev) => { const b = hit.getBoundingClientRect(); showTip(`${dayText(d)}  ${name} ${won(v, true)} 원`, b.left + b.width / 2 + window.scrollX, b.top + window.scrollY + 8); };
      hit.addEventListener('pointerenter', show); hit.addEventListener('pointerdown', show); hit.addEventListener('pointerleave', hideTip);
      svg.append(hit);
    });
    // 첫날·마지막 날짜
    const first = parseDay(rows[0].date), last = parseDay(rows[rows.length - 1].date);
    const md = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    svg.append(el('svg:text', { class: 'bar-date', x: 2, y: H - 4 }, md(first)), el('svg:text', { class: 'bar-date', x: W - 2, y: H - 4, 'text-anchor': 'end' }, md(last)));
    box.append(svg);
  }

  // 시가총액 상위 10
  function renderTop(top) {
    const body = $('#top-body');
    const rows = top?.rows || [];
    if (!rows.length) { body.replaceChildren(); $('#top-time').textContent = '시가총액 상위 종목 데이터를 아직 받지 못했습니다.'; return; }
    const maxCap = Math.max(...rows.map((r) => +r.mcap_jo || 0)) || 1;
    body.replaceChildren(...rows.map((r) => {
      const tr = el('tr');
      const nm = el('td', { class: 'nm' }); nm.append(r.name, el('small', {}, r.code));
      const cap = el('td', { class: 'cap' }); cap.append(`${nf(1).format(r.mcap_jo)}조`);
      const bar = el('div', { class: 'capbar', 'aria-hidden': 'true' }); const fill = el('span'); fill.style.width = `${(r.mcap_jo / maxCap) * 100}%`; bar.append(fill); cap.append(bar);
      tr.append(el('td', { class: 'rank' }, String(r.rank)), nm, el('td', { class: 'r' }, fmt(r.close, 0)), el('td', { class: `r ${tone(r.pct)}` }, signed(r.pct, 2, '%')), cap, el('td', { class: 'r hide-s' }, `${nf(0).format(r.value_eok)}억`));
      return tr;
    }));
    $('#top-time').textContent = `기준 ${rows[0].time || '—'} · 네이버 금융 시가총액 순위`;
  }

  // 레이더 그림
  function drawScope(scores) {
    const svg = $('#scope'); svg.replaceChildren();
    const C = 180, R = 120;
    const defs = el('svg:defs');
    const g = el('svg:linearGradient', { id: 'sweepGrad', x1: '0', y1: '0', x2: '1', y2: '0' });
    g.append(el('svg:stop', { offset: '0', 'stop-color': 'var(--signal)', 'stop-opacity': '0' }), el('svg:stop', { offset: '1', 'stop-color': 'var(--signal)', 'stop-opacity': '.28' }));
    defs.append(g); svg.append(defs);
    [25, 50, 75, 100].forEach((p) => svg.append(el('svg:circle', { cx: C, cy: C, r: (R * p) / 100, class: p === 50 ? 'sc-ring mid' : 'sc-ring' })));
    // 스윕: 위쪽에서 시계 방향 40도 부채꼴
    const a1 = -Math.PI / 2, a0 = a1 - (40 * Math.PI) / 180;
    svg.append(el('svg:path', { class: 'sc-sweep', d: `M${C},${C} L${C + R * Math.cos(a0)},${C + R * Math.sin(a0)} A${R},${R} 0 0 1 ${C + R * Math.cos(a1)},${C + R * Math.sin(a1)} Z` }));
    const ang = (i) => -Math.PI / 2 + (i * Math.PI * 2) / scores.length;
    scores.forEach((a, i) => {
      const t = ang(i), x = C + R * Math.cos(t), y = C + R * Math.sin(t);
      svg.append(el('svg:line', { x1: C, y1: C, x2: x, y2: y, class: 'sc-axis' }));
      const lx = C + (R + 30) * Math.cos(t), ly = C + (R + 30) * Math.sin(t);
      const anchor = Math.abs(Math.cos(t)) < 0.3 ? 'middle' : Math.cos(t) > 0 ? 'start' : 'end';
      const ox = anchor === 'start' ? -14 : anchor === 'end' ? 14 : 0;
      svg.append(el('svg:text', { x: lx + ox, y: ly + (Math.sin(t) > 0.5 ? 6 : Math.sin(t) < -0.5 ? -4 : 0), 'text-anchor': anchor, class: 'sc-label' }, a.name));
      svg.append(el('svg:text', { x: lx + ox, y: ly + (Math.sin(t) > 0.5 ? 22 : Math.sin(t) < -0.5 ? 12 : 16), 'text-anchor': anchor, class: 'sc-score' }, `${Math.round(a.v)}점`));
    });
    const pts = scores.map((a, i) => { const r = (R * Math.max(a.v, 3)) / 100; return [C + r * Math.cos(ang(i)), C + r * Math.sin(ang(i))]; });
    svg.append(el('svg:polygon', { class: 'sc-shape', points: pts.map((p) => p.join(',')).join(' ') }));
    pts.forEach(([x, y]) => svg.append(el('svg:circle', { cx: x, cy: y, r: 4, class: 'sc-dot' })));
  }

  // 툴팁
  const tip = $('#tip');
  const showTip = (text, pageX, pageY) => {
    tip.textContent = text; tip.hidden = false;
    const w = tip.offsetWidth, maxX = document.documentElement.clientWidth - w - 8;
    tip.style.left = `${Math.max(8, Math.min(pageX - w / 2, maxX + window.scrollX))}px`;
    tip.style.top = `${pageY - tip.offsetHeight - 14}px`;
  };
  const hideTip = () => { tip.hidden = true; };

  function hover(svg, s, x, y, toText, dotClass) {
    const dot = el('svg:circle', { r: 4, class: dotClass, visibility: 'hidden' });
    svg.append(dot);
    const pick = (ev) => {
      const box = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const mx = ((ev.clientX - box.left) / box.width) * vb.width;
      let best = 0, bd = Infinity;
      s.forEach((d, i) => { const dd = Math.abs(x(d.date) - mx); if (dd < bd) { bd = dd; best = i; } });
      const d = s[best];
      dot.setAttribute('cx', x(d.date)); dot.setAttribute('cy', y(d.close)); dot.setAttribute('visibility', 'visible');
      const px = box.left + (x(d.date) / vb.width) * box.width + window.scrollX;
      const py = box.top + (y(d.close) / vb.height) * box.height + window.scrollY;
      showTip(toText(d, best), px, py);
    };
    svg.addEventListener('pointermove', pick);
    svg.addEventListener('pointerdown', pick);
    svg.addEventListener('pointerleave', () => { dot.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  const scaleT = (s, a, b) => { const t0 = s[0].date, t1 = s[s.length - 1].date; return (d) => a + ((d - t0) / (t1 - t0 || 1)) * (b - a); };
  const scaleY = (lo, hi, a, b) => (v) => a + ((v - lo) / (hi - lo || 1)) * (b - a);
  const niceTicks = (lo, hi, n) => {
    const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0)), err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
    return out;
  };

  function drawSpark(box, s, d, name) {
    box.replaceChildren();
    if (s.length < 2) return;
    const W = Math.max(160, box.clientWidth), H = 48, p = 4;
    const vals = s.map((x) => x.close), lo = Math.min(...vals), hi = Math.max(...vals);
    const x = scaleT(s, p, W - p), y = scaleY(lo, hi, H - p, p);
    const svg = el('svg:svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${name} 최근 ${s.length}거래일 종가 추이` });
    const line = s.map((v, i) => `${i ? 'L' : 'M'}${x(v.date).toFixed(1)},${y(v.close).toFixed(1)}`).join('');
    const up = s[s.length - 1].close >= s[0].close;
    const color = up ? 'var(--up)' : 'var(--down)';
    const area = el('svg:path', { d: `${line}L${x(s[s.length - 1].date)},${H}L${x(s[0].date)},${H}Z` });
    area.style.fill = color; area.style.opacity = '.1';
    const path = el('svg:path', { d: line }); path.style.fill = 'none'; path.style.stroke = color; path.style.strokeWidth = '1.6';
    const end = el('svg:circle', { cx: x(s[s.length - 1].date), cy: y(s[s.length - 1].close), r: 3 }); end.style.fill = color;
    svg.append(area, path, end);
    box.append(svg);
    hover(svg, s, x, y, (v) => `${dayText(v.date)}  ${fmt(v.close, d)}`, 'k-hover');
  }

  function drawKospi(box, s, high) {
    box.replaceChildren();
    if (s.length < 2) { box.append(el('p', { class: 'error' }, '코스피 주봉 데이터가 없습니다.')); return; }
    const W = Math.max(300, box.clientWidth - 16), H = W < 520 ? 260 : 320;
    const m = { t: 22, r: 14, b: 28, l: 54 };
    const vals = s.map((v) => v.close);
    const lo = Math.min(...vals) * 0.94, hi = Math.max(Math.max(...vals), high || 0) * 1.04;
    const x = scaleT(s, m.l, W - m.r), y = scaleY(lo, hi, H - m.b, m.t);
    const svg = el('svg:svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '코스피 최근 2년 주봉 종가와 52주 최고치, 고점에서 떨어진 폭' });
    const ax = el('svg:g', { class: 'ax' });
    niceTicks(lo, hi, W < 520 ? 4 : 6).forEach((v) => {
      ax.append(el('svg:line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
      ax.append(el('svg:text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, nf(0).format(v)));
    });
    // 가로축: 분기마다 한 번
    let lastQ = '';
    const every = W < 520 ? 6 : 3;
    s.forEach((v) => {
      const mo = v.date.getUTCMonth();
      const q = `${v.date.getUTCFullYear()}-${mo}`;
      if (mo % every === 0 && q !== lastQ && v.date.getUTCDate() <= 7) {
        lastQ = q;
        ax.append(el('svg:text', { x: x(v.date), y: H - 8, 'text-anchor': 'middle' }, `${String(v.date.getUTCFullYear()).slice(2)}.${String(mo + 1).padStart(2, '0')}`));
      }
    });
    svg.append(ax);
    // 고점에서 떨어진 폭(그때까지의 최고치와 종가 사이)
    let runMax = -Infinity;
    const peak = s.map((v) => (runMax = Math.max(runMax, v.close)));
    const top = s.map((v, i) => `${i ? 'L' : 'M'}${x(v.date).toFixed(1)},${y(peak[i]).toFixed(1)}`).join('');
    const bottom = s.slice().reverse().map((v) => `L${x(v.date).toFixed(1)},${y(v.close).toFixed(1)}`).join('');
    svg.append(el('svg:path', { class: 'k-dd', d: `${top}${bottom}Z` }));
    if (high) {
      svg.append(el('svg:line', { class: 'k-high', x1: m.l, x2: W - m.r, y1: y(high), y2: y(high) }));
      svg.append(el('svg:text', { class: 'k-high-label', x: m.l + 6, y: y(high) - 7 }, `52주 최고 ${fmt(high)}`));
    }
    svg.append(el('svg:path', { class: 'k-line', d: s.map((v, i) => `${i ? 'L' : 'M'}${x(v.date).toFixed(1)},${y(v.close).toFixed(1)}`).join('') }));
    const last = s[s.length - 1];
    svg.append(el('svg:circle', { class: 'k-end', cx: x(last.date), cy: y(last.close), r: 4 }));
    box.append(svg);
    hover(svg, s, x, y, (v, i) => `${dayText(v.date)} 주  ${fmt(v.close)}  (그때까지 고점 대비 ${signed((v.close / peak[i] - 1) * 100, 1, '%')})`, 'k-hover');
  }
})();
