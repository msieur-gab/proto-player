import { indexFromRotation, rotationForIndex, shortestDelta } from '../utils/ring-math.js';

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
      will-change: transform;
    }
  </style>
  <div class="ring">
    <div class="track"></div>
    <div class="items">
      <slot></slot>
    </div>
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
    this._slot = this.shadowRoot.querySelector('slot');

    this._rotation = 0;
    this._highlightedIndex = 0;
    this._children = [];
    this._selectionY = 0.7;

    this._drag = {
      on: false, moved: false,
      x0: 0, rot0: 0, v: 0,
      xPrev: 0, tPrev: 0,
    };

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  connectedCallback() {
    this._slot.addEventListener('slotchange', () => this._onSlotChange());
    this._items.addEventListener('mousedown', this._onDown);
    this._items.addEventListener('touchstart', this._onDown, { passive: true });
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('touchmove', this._onMove, { passive: true });
    document.addEventListener('mouseup', this._onUp);
    document.addEventListener('touchend', this._onUp);
    window.addEventListener('resize', this._onResize);

    requestAnimationFrame(() => {
      this._layout();
      this._applyRotation(false);
      this._updateHighlight();
    });
  }

  disconnectedCallback() {
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('touchmove', this._onMove);
    document.removeEventListener('mouseup', this._onUp);
    document.removeEventListener('touchend', this._onUp);
    window.removeEventListener('resize', this._onResize);
  }

  get selectedIndex() { return this._highlightedIndex; }
  get dragMoved() { return this._drag.moved; }

  rotateTo(index, animate = true) {
    const count = this._children.length;
    if (!count) return;
    this._rotation += shortestDelta(this._rotation, rotationForIndex(index, count));
    this._highlightedIndex = index;
    this._applyRotation(animate);
    this._updateHighlight();
  }

  // --- Internal ---

  _onSlotChange() {
    this._children = this._slot.assignedElements();
    this._layout();
    this._applyRotation(false);
    this._updateHighlight();
  }

  _layout() {
    const r = this._ring.offsetWidth / 2;
    // Position viewport so the selection point sits at _selectionY of the screen
    this.style.bottom = (innerHeight * (1 - this._selectionY) - r) + 'px';
    this._positionChildren();
  }

  _positionChildren() {
    const r = this._ring.offsetWidth / 2;
    const count = this._children.length;
    if (!count) return;
    const ang = 360 / count;

    this._children.forEach((el, i) => {
      const deg = i * ang - 90;
      const rad = deg * Math.PI / 180;
      el.style.transform =
        `translate(calc(-50% + ${Math.cos(rad) * r}px), calc(-50% + ${Math.sin(rad) * r}px)) rotate(${deg + 90}deg)`;
    });
  }

  _applyRotation(animate) {
    this._items.style.transition = animate
      ? 'transform 0.5s cubic-bezier(0.4,0,0.2,1)'
      : 'none';
    this._items.style.transform = `rotate(${this._rotation}deg)`;
  }

  _updateHighlight() {
    const count = this._children.length;
    if (!count) return;

    this._children.forEach((el, i) => {
      const d = Math.min(
        (i - this._highlightedIndex + count) % count,
        (this._highlightedIndex - i + count) % count
      );
      el.toggleAttribute('highlighted', d === 0);
      el.toggleAttribute('near', d > 0 && d <= 2);
    });

    this.dispatchEvent(new CustomEvent('selection-changed', {
      detail: { index: this._highlightedIndex },
      bubbles: true,
    }));
  }

  _snap() {
    const count = this._children.length;
    if (!count) return;
    this.rotateTo(indexFromRotation(this._rotation, count));
  }

  // --- Gesture handlers ---

  _getX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }

  _onDown(e) {
    const x = this._getX(e);
    this._drag = {
      on: true, moved: false,
      x0: x, rot0: this._rotation, v: 0,
      xPrev: x, tPrev: Date.now(),
    };
    this._applyRotation(false);
  }

  _onMove(e) {
    if (!this._drag.on) return;
    const x = this._getX(e);
    if (Math.abs(x - this._drag.x0) > 3) this._drag.moved = true;

    this._rotation = this._drag.rot0 + (x - this._drag.x0) * 0.4;

    const now = Date.now(), dt = now - this._drag.tPrev;
    if (dt > 0) this._drag.v = (x - this._drag.xPrev) / dt;
    this._drag.xPrev = x;
    this._drag.tPrev = now;

    this._applyRotation(false);

    const count = this._children.length;
    const idx = indexFromRotation(this._rotation, count);
    if (idx !== this._highlightedIndex) {
      this._highlightedIndex = idx;
      this._updateHighlight();
    }
  }

  _onUp() {
    if (!this._drag.on) return;
    this._drag.on = false;
    if (!this._drag.moved) return;
    this._rotation += this._drag.v * 80;
    this._snap();
  }

  _onResize() { this._layout(); }
}

customElements.define('ring-carousel', RingCarousel);
