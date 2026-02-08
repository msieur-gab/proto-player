import { rgb, gradient, tint, dark } from '../utils/palette.js';

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 50;
      pointer-events: none;
      opacity: 0;
    }
    :host([active]) { pointer-events: auto; opacity: 1; }

    .surface {
      position: absolute;
      overflow: hidden;
      box-shadow: 0 8px 60px rgba(26, 23, 20, 0.2);
      will-change: left, top, width, height, border-radius;
    }
    .surface.animating {
      transition:
        left 0.35s cubic-bezier(0.4,0,0.15,1),
        top 0.35s cubic-bezier(0.4,0,0.15,1),
        width 0.35s cubic-bezier(0.4,0,0.15,1),
        height 0.35s cubic-bezier(0.4,0,0.15,1),
        border-radius 0.35s cubic-bezier(0.4,0,0.15,1);
    }
    .surface.full {
      left: 0 !important;
      top: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      border-radius: 0 !important;
    }

    article {
      position: absolute;
      inset: 0;
      overflow-y: auto;
      opacity: 0;
      transition: opacity 0.25s ease 0.2s;
      display: flex;
      flex-direction: column;
    }
    :host([open]) article { opacity: 1; }
    :host([closing]) article { opacity: 0; transition: opacity 0.15s; }

    .hero {
      position: relative;
      width: 100%;
      aspect-ratio: 1;
      max-height: 55vh;
      overflow: hidden;
      flex-shrink: 0;
    }
    .hero img {
      width: 100%; height: 100%;
      object-fit: cover; display: block;
    }
    .hero-fade {
      position: absolute;
      bottom: 0; left: 0; right: 0; height: 50%;
    }

    nav {
      position: absolute;
      top: 1rem; left: 1rem;
      z-index: 5;
    }
    nav button {
      width: 2.5rem; height: 2.5rem;
      border-radius: 50%;
      border: none;
      background: rgba(255, 253, 249, 0.85);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 12px rgba(26, 23, 20, 0.1);
      transition: transform 0.2s;
    }
    nav button:hover { transform: scale(1.08); }
    nav button svg {
      width: 16px; height: 16px;
      stroke: #1a1714;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .body {
      padding: 0 1.5rem 2rem;
      flex: 1;
      margin-top: -2rem;
      position: relative;
      z-index: 2;
    }
    h2 {
      font-family: 'Instrument Serif', serif;
      font-size: 1.75rem;
      font-weight: 400;
      line-height: 1.15;
      margin: 0 0 0.25rem;
    }
    .artist {
      font-size: 0.85rem;
      font-weight: 300;
      color: #6b635a;
      letter-spacing: 0.03em;
      margin: 0 0 1.5rem;
    }
    .play {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.65rem 1.4rem;
      color: #fff;
      border: none;
      border-radius: 2rem;
      font-size: 0.7rem;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: pointer;
      margin-bottom: 1.75rem;
      transition: transform 0.2s;
    }
    .play:hover { transform: scale(1.04); }
    .play svg { width: 12px; height: 12px; fill: currentColor; }

    ol { list-style: none; padding: 0; margin: 0; }
    li {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.85rem 0.25rem;
      border-bottom: 1px solid rgba(26, 23, 20, 0.05);
      cursor: pointer;
      transition: background 0.2s;
      border-radius: 4px;
    }
    li:hover { background: rgba(26, 23, 20, 0.02); }
    li.playing { background: rgba(26, 23, 20, 0.06); }
    li.playing .track-title { color: #6b635a; }
    .num {
      font-size: 0.7rem;
      color: #a09889;
      min-width: 1.5rem;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .track-info { flex: 1; min-width: 0; }
    .track-title { font-size: 0.8rem; font-weight: 500; line-height: 1.3; }
    time {
      font-size: 0.65rem;
      color: #a09889;
      font-variant-numeric: tabular-nums;
    }
  </style>

  <div class="surface">
    <article>
      <div class="hero">
        <img alt="">
        <div class="hero-fade"></div>
        <nav>
          <button type="button" aria-label="Back">
            <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        </nav>
      </div>
      <section class="body">
        <h2></h2>
        <p class="artist"></p>
        <button type="button" class="play">
          <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
          Play All
        </button>
        <ol></ol>
      </section>
    </article>
  </div>
`;

class AlbumDetail extends HTMLElement {
  static get observedAttributes() { return ['active', 'open', 'closing']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(template.content.cloneNode(true));

    this._surface = this.shadowRoot.querySelector('.surface');
    this._img = this.shadowRoot.querySelector('.hero img');
    this._fade = this.shadowRoot.querySelector('.hero-fade');
    this._body = this.shadowRoot.querySelector('.body');
    this._h2 = this.shadowRoot.querySelector('h2');
    this._artist = this.shadowRoot.querySelector('.artist');
    this._play = this.shadowRoot.querySelector('.play');
    this._tracks = this.shadowRoot.querySelector('ol');

    this.shadowRoot.querySelector('nav button').addEventListener('click', (e) => {
      e.stopPropagation();
      this.dispatchEvent(new CustomEvent('detail-close', { bubbles: true }));
    });

    // Play All button
    this._play.addEventListener('click', () => {
      if (this._album) {
        this.dispatchEvent(new CustomEvent('track-play', {
          bubbles: true,
          detail: { album: this._album, trackIndex: 0 },
        }));
      }
    });

    // Track list — event delegation
    this._tracks.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (!li || !this._album) return;
      const items = [...this._tracks.querySelectorAll('li')];
      const idx = items.indexOf(li);
      if (idx >= 0) {
        this.dispatchEvent(new CustomEvent('track-play', {
          bubbles: true,
          detail: { album: this._album, trackIndex: idx },
        }));
      }
    });

    this._album = null;
  }

  setPlayingTrack(index) {
    const items = this._tracks.querySelectorAll('li');
    items.forEach((li, i) => {
      li.classList.toggle('playing', i === index);
    });
  }

  updateTracks(tracks) {
    const items = this._tracks.querySelectorAll('li');
    items.forEach((li, i) => {
      if (tracks[i]) {
        const time = li.querySelector('time');
        if (time) time.textContent = tracks[i].dur;
      }
    });
  }

  open(album, palette, originRect) {
    this._album = album;

    // Populate content
    this._img.src = album.cover;
    this._img.alt = album.title;
    this._img.style.background = palette ? rgb(palette[0]) : '#888';
    this._fade.style.background = `linear-gradient(to top, ${tint(palette)}, transparent)`;
    this._body.style.background = tint(palette);
    this._play.style.background = dark(palette);
    this._h2.textContent = album.title;
    this._artist.textContent = album.artist;

    this._tracks.innerHTML = album.tracks.map((t, n) => `
      <li>
        <span class="num">${n + 1}</span>
        <div class="track-info"><span class="track-title">${t.title}</span></div>
        <time>${t.dur}</time>
      </li>`).join('');

    // Position surface at card origin
    Object.assign(this._surface.style, {
      left: originRect.left + 'px',
      top: originRect.top + 'px',
      width: originRect.width + 'px',
      height: originRect.height + 'px',
      borderRadius: '10px',
      background: gradient(palette),
    });

    this._surface.classList.remove('animating', 'full');
    this.setAttribute('active', '');

    // Force reflow, then animate to fullscreen
    this._surface.offsetHeight;
    this._surface.classList.add('animating', 'full');
    setTimeout(() => this.setAttribute('open', ''), 250);
  }

  close(targetRect) {
    this.setAttribute('closing', '');
    this.removeAttribute('open');

    setTimeout(() => {
      this._surface.classList.remove('full');
      Object.assign(this._surface.style, {
        left: targetRect.left + 'px',
        top: targetRect.top + 'px',
        width: targetRect.width + 'px',
        height: targetRect.height + 'px',
        borderRadius: '10px',
      });

      setTimeout(() => {
        this.removeAttribute('active');
        this.removeAttribute('closing');
        this._surface.classList.remove('animating');
      }, 350);
    }, 120);
  }
}

customElements.define('album-detail', AlbumDetail);
