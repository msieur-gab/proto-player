import { extractPalette, rgb } from '../utils/palette.js';

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: block;
      position: absolute;
      top: 50%; left: 50%;
      cursor: pointer;
      transition: opacity 0.3s, filter 0.3s;
      filter: saturate(0.5);
      opacity: 0.5;
    }
    :host([highlighted]) { filter: saturate(1); opacity: 1; }
    :host([near])        { filter: saturate(0.75); opacity: 0.7; }
    :host([expanding])   { opacity: 0; transition: opacity 0.15s; }

    figure {
      margin: 0;
      width: 120px;
      border-radius: 10px;
      overflow: hidden;
      background: #fffdf9;
      box-shadow: 0 2px 14px rgba(26, 23, 20, 0.08);
      transition: transform 0.35s cubic-bezier(0.4,0,0.2,1), box-shadow 0.35s;
    }
    :host([highlighted]) figure {
      transform: scale(1.15);
      box-shadow: 0 8px 32px rgba(26, 23, 20, 0.15);
    }
    @media (min-width: 768px) { figure { width: 146px; } }

    img {
      width: 100%;
      aspect-ratio: 1;
      display: block;
      object-fit: cover;
    }
    figcaption { padding: 0.5rem 0.6rem 0.6rem; }
    strong {
      display: block;
      font-size: 0.7rem;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }
    small {
      display: block;
      font-size: 0.6rem;
      font-weight: 300;
      color: #a09889;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.1rem;
    }
  </style>
  <figure>
    <img draggable="false" alt="">
    <figcaption>
      <strong></strong>
      <small></small>
    </figcaption>
  </figure>
`;

class AlbumCard extends HTMLElement {
  static get observedAttributes() { return ['highlighted', 'near', 'expanding']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this._img = this.shadowRoot.querySelector('img');
    this._title = this.shadowRoot.querySelector('strong');
    this._artist = this.shadowRoot.querySelector('small');
    this._palette = null;
    this._loadHandler = null;
  }

  set album(data) {
    this._album = data;
    this._title.textContent = data.title;
    this._artist.textContent = data.artist;
    this._img.alt = data.title;

    if (this._loadHandler) {
      this._img.removeEventListener('load', this._loadHandler);
    }
    if (this._errorHandler) {
      this._img.removeEventListener('error', this._errorHandler);
    }

    this._loadHandler = () => {
      try {
        this._palette = extractPalette(this._img);
      } catch {
        this._palette = null;
      }
      if (this._palette) {
        this._img.style.backgroundColor = rgb(this._palette[0]);
      }
      this.dispatchEvent(new CustomEvent('palette-ready', {
        detail: { palette: this._palette },
        bubbles: true,
      }));
      this._img.removeEventListener('load', this._loadHandler);
      this._loadHandler = null;
    };
    this._errorHandler = () => {
      console.warn(`[album-card] Image failed to load for "${data.title}"`);
      this._img.removeEventListener('error', this._errorHandler);
      this._errorHandler = null;
    };
    this._img.addEventListener('load', this._loadHandler);
    this._img.addEventListener('error', this._errorHandler, { once: true });

    // Only set crossorigin for external URLs (needed for canvas palette extraction).
    // Blob URLs and data URIs are same-origin — crossorigin can block them in Chrome.
    if (data.cover && data.cover.startsWith('http')) {
      this._img.crossOrigin = 'anonymous';
    } else {
      this._img.removeAttribute('crossorigin');
    }

    this._img.src = data.cover;
  }

  get album() { return this._album; }
  get palette() { return this._palette; }

  /** Returns the figure's bounding rect for FLIP animations */
  getRect() {
    return this.shadowRoot.querySelector('figure').getBoundingClientRect();
  }
}

customElements.define('album-card', AlbumCard);
