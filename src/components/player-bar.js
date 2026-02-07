// Bottom playback bar — <player-bar> custom element

const tpl = document.createElement('template');
tpl.innerHTML = `
  <style>
    :host {
      display: block;
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 60;
      transform: translateY(100%);
      transition: transform 0.35s cubic-bezier(0.4, 0, 0.15, 1);
      pointer-events: none;
    }
    :host([visible]) {
      transform: translateY(0);
      pointer-events: auto;
    }

    .bar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.6rem 1.25rem;
      margin: 0 0.75rem 0.75rem;
      border-radius: 1rem;
      background: rgba(255, 253, 249, 0.82);
      backdrop-filter: blur(20px) saturate(1.4);
      -webkit-backdrop-filter: blur(20px) saturate(1.4);
      box-shadow: 0 4px 24px rgba(26, 23, 20, 0.12), 0 1px 4px rgba(26, 23, 20, 0.06);
      min-height: 56px;
    }

    button {
      background: none; border: none; cursor: pointer; padding: 0;
      display: flex; align-items: center; justify-content: center;
      color: #1a1714;
      width: 2rem; height: 2rem;
      border-radius: 50%;
      transition: background 0.15s;
      flex-shrink: 0;
    }
    button:hover { background: rgba(26, 23, 20, 0.06); }
    button svg { width: 14px; height: 14px; fill: currentColor; }

    .prev svg, .next svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    .info {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column; gap: 0.15rem;
    }
    .title {
      font-size: 0.75rem; font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: #1a1714;
    }
    .artist {
      font-size: 0.6rem; font-weight: 300;
      color: #6b635a; letter-spacing: 0.03em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .progress-wrap {
      position: absolute;
      top: -3px; left: 1.5rem; right: 1.5rem;
      height: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
    }
    .progress-bg {
      width: 100%; height: 2px;
      background: rgba(26, 23, 20, 0.1);
      border-radius: 1px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: #1a1714;
      width: 0%;
      border-radius: 1px;
      transition: width 0.15s linear;
    }

    .time {
      font-size: 0.55rem;
      color: #a09889;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
      min-width: 2.5rem;
      text-align: right;
    }
  </style>

  <div class="bar">
    <div class="progress-wrap">
      <div class="progress-bg"><div class="progress-fill"></div></div>
    </div>

    <button class="prev" aria-label="Previous track">
      <svg viewBox="0 0 24 24"><polyline points="19 20 9 12 19 4"/><line x1="5" y1="4" x2="5" y2="20"/></svg>
    </button>

    <button class="play-pause" aria-label="Play/Pause">
      <svg class="icon-play" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
      <svg class="icon-pause" viewBox="0 0 24 24" style="display:none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
    </button>

    <button class="next" aria-label="Next track">
      <svg viewBox="0 0 24 24"><polyline points="5 4 15 12 5 20"/><line x1="19" y1="4" x2="19" y2="20"/></svg>
    </button>

    <div class="info">
      <span class="title">—</span>
      <span class="artist">&nbsp;</span>
    </div>

    <span class="time">0:00</span>
  </div>
`;

class PlayerBar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(tpl.content.cloneNode(true));

    this._title = this.shadowRoot.querySelector('.title');
    this._artist = this.shadowRoot.querySelector('.artist');
    this._fill = this.shadowRoot.querySelector('.progress-fill');
    this._progressWrap = this.shadowRoot.querySelector('.progress-wrap');
    this._time = this.shadowRoot.querySelector('.time');
    this._iconPlay = this.shadowRoot.querySelector('.icon-play');
    this._iconPause = this.shadowRoot.querySelector('.icon-pause');

    // Button events — dispatch to document for app.js to handle
    this.shadowRoot.querySelector('.play-pause').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('bar-toggle', { bubbles: true }));
    });
    this.shadowRoot.querySelector('.prev').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('bar-prev', { bubbles: true }));
    });
    this.shadowRoot.querySelector('.next').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('bar-next', { bubbles: true }));
    });

    // Progress bar seek
    this._progressWrap.addEventListener('click', (e) => {
      const rect = this._progressWrap.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.dispatchEvent(new CustomEvent('bar-seek', { bubbles: true, detail: { fraction } }));
    });
  }

  setTrack(title, artist) {
    this._title.textContent = title;
    this._artist.textContent = artist;
    if (!this.hasAttribute('visible')) this.setAttribute('visible', '');
  }

  setPlaying(playing) {
    this._iconPlay.style.display = playing ? 'none' : 'block';
    this._iconPause.style.display = playing ? 'block' : 'none';
  }

  setProgress(currentTime, duration) {
    if (!isFinite(duration) || duration <= 0) return;
    const pct = (currentTime / duration) * 100;
    this._fill.style.width = pct + '%';

    const m = Math.floor(currentTime / 60);
    const s = Math.floor(currentTime % 60);
    this._time.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }
}

customElements.define('player-bar', PlayerBar);
