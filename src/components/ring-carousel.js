import {
  ARC_STEP, POOL_HALF, POOL_SIZE,
  angleForSlot, angleToXY, tangentRotation,
  wrapIndex, visibleSlots, fractionalOffset,
  PX_PER_INDEX, pxToIndexDelta,
} from '../utils/ring-math.js';

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: block;
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      width: 200vw;
      height: 200vw;
      transition: opacity 0.5s, filter 0.5s;
    }
    @media (min-width: 768px) {
      :host { width: 120vw; height: 120vw; }
    }
    :host([dimmed]) { opacity: 0.15; filter: blur(8px); pointer-events: none; }

    .ring {
      position: absolute;
      bottom: 0; left: 50%;
      transform: translateX(-50%) translateY(50%);
      width: 100%; height: 100%;
      border-radius: 50%;
    }
    .track {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 1px solid rgba(26, 23, 20, 0.06);
    }
    .items {
      position: absolute;
      width: 100%; height: 100%;
    }
  </style>
  <div class="ring">
    <div class="track"></div>
    <div class="items"></div>
  </div>
`;

class RingCarousel extends HTMLElement {
  static get observedAttributes() { return ['dimmed']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(template.content.cloneNode(true));

    this._ring = this.shadowRoot.querySelector('.ring');
    this._items = this.shadowRoot.querySelector('.items');

    this._albums = [];
    this._currentIndex = 0;
    this._selectedIndex = 0;
    this._pool = [];          // { el, albumIndex, slotOffset }
    this._paletteCache = new Map();
    this._selectionY = 0.7;
    this._snapRaf = null;

    this._drag = {
      on: false, moved: false,
      x0: 0, idx0: 0, v: 0,
      xPrev: 0, tPrev: 0,
    };

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  connectedCallback() {
    this._items.addEventListener('mousedown', this._onDown);
    this._items.addEventListener('touchstart', this._onDown, { passive: true });
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('touchmove', this._onMove, { passive: true });
    document.addEventListener('mouseup', this._onUp);
    document.addEventListener('touchend', this._onUp);
    window.addEventListener('resize', this._onResize);

    requestAnimationFrame(() => this._layoutRing());
  }

  disconnectedCallback() {
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('touchmove', this._onMove);
    document.removeEventListener('mouseup', this._onUp);
    document.removeEventListener('touchend', this._onUp);
    window.removeEventListener('resize', this._onResize);
    if (this._snapRaf) cancelAnimationFrame(this._snapRaf);
  }

  // --- Public API ---

  get selectedIndex() { return this._selectedIndex; }
  get dragMoved() { return this._drag.moved; }

  setAlbums(albumsArray) {
    this._albums = albumsArray;
    this._currentIndex = 0;
    this._selectedIndex = 0;
    this._paletteCache.clear();

    // Reset all pool entries so _syncPool reassigns fresh album data
    for (const entry of this._pool) {
      entry.albumIndex = -1;
    }

    if (!this._pool.length) this._createPool();
    this._syncPool();
    this._positionCards();
    this._updateHighlight();
  }

  goTo(index, animate = true) {
    const count = this._albums.length;
    if (!count) return;
    if (animate) {
      this._snapTo(index);
    } else {
      this._currentIndex = index;
      this._selectedIndex = index;
      this._syncPool();
      this._positionCards();
      this._updateHighlight();
    }
  }

  rotateTo(index, animate = true) { this.goTo(index, animate); }

  getCardRect(albumIndex) {
    for (const slot of this._pool) {
      if (slot.albumIndex === albumIndex && slot.el.style.display !== 'none') {
        return slot.el.getRect();
      }
    }
    return null;
  }

  getCardElement(albumIndex) {
    for (const slot of this._pool) {
      if (slot.albumIndex === albumIndex && slot.el.style.display !== 'none') {
        return slot.el;
      }
    }
    return null;
  }

  getPalette(albumIndex) {
    return this._paletteCache.get(albumIndex) || null;
  }

  // --- Pool management ---

  _createPool() {
    this._pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const el = document.createElement('album-card');
      el.addEventListener('click', () => {
        const slot = this._pool.find(s => s.el === el);
        if (slot && slot.albumIndex !== -1) {
          this.dispatchEvent(new CustomEvent('card-click', {
            detail: { index: slot.albumIndex },
            bubbles: true,
          }));
        }
      });
      el.addEventListener('palette-ready', (e) => {
        const slot = this._pool.find(s => s.el === el);
        if (slot && slot.albumIndex !== -1) {
          this._paletteCache.set(slot.albumIndex, e.detail.palette);
          this.dispatchEvent(new CustomEvent('palette-ready', {
            detail: { index: slot.albumIndex, palette: e.detail.palette },
            bubbles: true,
          }));
        }
      });
      this._items.appendChild(el);
      this._pool.push({ el, albumIndex: -1, slotOffset: 0 });
    }
  }

  _syncPool() {
    const count = this._albums.length;
    const slots = visibleSlots(this._currentIndex, count);

    // Build a set of needed album indices
    const needed = new Set(slots.map(s => s.albumIndex));

    // Mark pool entries not in needed set as available
    const available = [];
    for (const entry of this._pool) {
      if (!needed.has(entry.albumIndex)) {
        available.push(entry);
      }
    }

    // Assign slots
    for (const slot of slots) {
      // Already in pool?
      let existing = this._pool.find(
        e => e.albumIndex === slot.albumIndex
      );
      if (existing) {
        existing.slotOffset = slot.slotOffset;
        existing.el.style.display = '';
        continue;
      }
      // Recycle from available
      const entry = available.pop();
      if (!entry) continue;
      entry.albumIndex = slot.albumIndex;
      entry.slotOffset = slot.slotOffset;
      entry.el.album = this._albums[slot.albumIndex];
      entry.el.style.display = '';
    }

    // Hide unused pool entries
    for (const entry of available) {
      entry.el.style.display = 'none';
      entry.albumIndex = -1;
    }
  }

  _positionCards() {
    const r = this._ring.offsetWidth / 2;
    if (!r) return;
    const frac = fractionalOffset(this._currentIndex);

    for (const entry of this._pool) {
      if (entry.albumIndex === -1) continue;
      const angle = angleForSlot(entry.slotOffset, frac);
      const { x, y } = angleToXY(angle, r);
      const rot = tangentRotation(angle);
      entry.el.style.transform =
        `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${rot}deg)`;
    }
  }

  _updateHighlight() {
    const count = this._albums.length;
    if (!count) return;

    const prev = this._selectedIndex;
    this._selectedIndex = wrapIndex(Math.round(this._currentIndex), count);

    for (const entry of this._pool) {
      if (entry.albumIndex === -1) continue;
      const d = Math.min(
        (entry.albumIndex - this._selectedIndex + count) % count,
        (this._selectedIndex - entry.albumIndex + count) % count
      );
      entry.el.toggleAttribute('highlighted', d === 0);
      entry.el.toggleAttribute('near', d > 0 && d <= 2);
    }

    if (this._selectedIndex !== prev) {
      this.dispatchEvent(new CustomEvent('selection-changed', {
        detail: { index: this._selectedIndex },
        bubbles: true,
      }));
    }
  }

  // --- Snap animation ---

  _snapTo(targetIndex) {
    if (this._snapRaf) cancelAnimationFrame(this._snapRaf);

    const count = this._albums.length;
    // Find shortest wrap path
    let target = targetIndex;
    const current = this._currentIndex;
    const diff = target - current;
    // Wrap: if going more than half the list, go the other way
    if (count > 1) {
      if (diff > count / 2) target -= count;
      else if (diff < -count / 2) target += count;
    }

    const start = this._currentIndex;
    const delta = target - start;
    const duration = 500;
    const t0 = performance.now();

    const tick = (now) => {
      const elapsed = now - t0;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      this._currentIndex = start + delta * ease;

      this._syncPool();
      this._positionCards();
      this._updateHighlight();

      if (progress < 1) {
        this._snapRaf = requestAnimationFrame(tick);
      } else {
        this._snapRaf = null;
        this._currentIndex = wrapIndex(targetIndex, count);
        this._syncPool();
        this._positionCards();
        this._updateHighlight();
      }
    };

    this._snapRaf = requestAnimationFrame(tick);
  }

  // --- Layout ---

  _layoutRing() {
    const r = this._ring.offsetWidth / 2;
    this.style.bottom = (innerHeight * (1 - this._selectionY) - r) + 'px';
    this._positionCards();
  }

  // --- Gesture handlers ---

  _getX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }

  _onDown(e) {
    if (this._snapRaf) {
      cancelAnimationFrame(this._snapRaf);
      this._snapRaf = null;
    }
    const x = this._getX(e);
    this._drag = {
      on: true, moved: false,
      x0: x, idx0: this._currentIndex, v: 0,
      xPrev: x, tPrev: Date.now(),
    };
  }

  _onMove(e) {
    if (!this._drag.on) return;
    const x = this._getX(e);
    if (Math.abs(x - this._drag.x0) > 3) this._drag.moved = true;

    const deltaX = x - this._drag.x0;
    this._currentIndex = this._drag.idx0 - pxToIndexDelta(deltaX);

    // Wrap for continuous scrolling
    const count = this._albums.length;
    if (count > 0) {
      this._currentIndex = ((this._currentIndex % count) + count) % count;
    }

    const now = Date.now(), dt = now - this._drag.tPrev;
    if (dt > 0) this._drag.v = (x - this._drag.xPrev) / dt;
    this._drag.xPrev = x;
    this._drag.tPrev = now;

    this._syncPool();
    this._positionCards();
    this._updateHighlight();
  }

  _onUp() {
    if (!this._drag.on) return;
    this._drag.on = false;
    if (!this._drag.moved) return;

    const count = this._albums.length;
    if (!count) return;

    // Apply inertia
    const inertia = -pxToIndexDelta(this._drag.v * 80);
    this._currentIndex += inertia;

    // Wrap
    this._currentIndex = ((this._currentIndex % count) + count) % count;

    const target = wrapIndex(Math.round(this._currentIndex), count);
    this._snapTo(target);
  }

  _onResize() { this._layoutRing(); }
}

customElements.define('ring-carousel', RingCarousel);
