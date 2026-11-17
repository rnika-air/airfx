import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Wordmark } from '../components/Wordmark';
import { LIBRARY } from '../effects/registry';
import { previews, SHOWCASE_GIF } from '../intro/previews';
import { LiveFx } from '../intro/LiveFx';
import { CONTACT, COPYRIGHT_YEAR, CREATOR } from './config';

/**
 * About AirFx: an editorial information page. Desktop keeps the reference's
 * columns (number, section label, text, side notes); phones stack the
 * sections, with a section index that stays at the top.
 */

const SECTIONS = [
  { id: 'about', label: 'About' },
  { id: 'info', label: 'Info' },
  { id: 'features', label: 'Features' },
  { id: 'creator', label: 'Created By' },
  { id: 'contact', label: 'Contact' },
  { id: 'legal', label: 'Legal' },
] as const;

const FEATURES: [string, string][] = [
  ['Image Editing', 'JPG, PNG and WEBP, previewed live and exported at full resolution.'],
  ['Video Editing', 'MP4 and WEBM clips with playback, a timeline and video export.'],
  ['Experimental Effects', `${LIBRARY.filter((e) => e.category !== 'adjust').length} effects across pattern, distortion, texture, light, analog, type and motion.`],
  ['AI-Powered Tools', 'Click-to-select objects, object removal and scene suggestions, with models that run on your device.'],
  ['Depth Mapping', 'Depth maps from a single image for focus, fog, parallax and depth-limited effects.'],
  ['Background Removal', 'AirFx Key: AI mattes for people and objects, plus classic colour keying.'],
  ['Audio-Reactive Visuals', 'Effects that follow the bass, mids, highs and beat of a song or the microphone.'],
  ['Customizable Effects', 'Stack effects as layers, tune every parameter, and save your own presets.'],
];

const TOPICS = ['Feedback', 'Bug Reports', 'Collaborations', 'Feature Suggestions'];

function Section({ n, id, label, children, aside }: { n: number; id: string; label: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="ab__sec" id={`ab-${id}`} aria-labelledby={`ab-${id}-h`}>
      <span className="ab__n">{String(n).padStart(2, '0')}</span>
      <h2 className="ab__label" id={`ab-${id}-h`}>{label}</h2>
      <div className="ab__body">{children}</div>
      <div className="ab__aside">{aside}</div>
    </section>
  );
}

export function About({ onClose }: { onClose: () => void }) {
  const list = useSyncExternalStore(previews.subscribe, previews.get);
  const scroller = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState<string>('about');
  useEffect(() => { previews.start(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  // Highlight the section being read in the index.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setCurrent(vis.target.id.slice(3));
    }, { root, rootMargin: '-20% 0px -60% 0px' });
    root.querySelectorAll('.ab__sec').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);
  const jump = (id: string) => scroller.current?.querySelector(`#ab-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const mail = (topic: string) => `mailto:${CONTACT.email}?subject=${encodeURIComponent(`AirFx: ${topic}`)}`;

  return (
    <div className="ab" role="dialog" aria-modal="true" aria-label="About AirFx">
      <header className="brandbar">
        <button className="pill" onClick={onClose}><span aria-hidden>←</span> Back</button>
        <span className="brandbar__mid mono">Information · v{__APP_VERSION__}</span>
        <Wordmark />
      </header>
      <nav className="ab__index" aria-label="Sections">
        {SECTIONS.map((s, i) => (
          <button key={s.id} className={current === s.id ? 'on' : ''} onClick={() => jump(s.id)}><span>{String(i + 1).padStart(2, '0')}</span>{s.label}</button>
        ))}
      </nav>
      <div className="ab__scroll" ref={scroller}>
        <div className="ab__hero">
          <p className="ab__kicker mono">(About AirFx)</p>
          <p className="ab__statement">An experimental visual playground for images, video, motion and sound.</p>
          <div className="ab__strip" aria-hidden>
            <LiveFx src={SHOWCASE_GIF} kind="gif" className="ab__live" offset={4} caption={(name) => <figcaption className="mono">{name} · Live</figcaption>} />
            {list.slice(0, 5).map((p) => <figure key={p.id}><img src={p.url} alt="" /><figcaption className="mono">{p.name}</figcaption></figure>)}
          </div>
        </div>

        <Section n={1} id="about" label="About" aside={<p className="mono">Independent software<br />Made in Malaysia</p>}>
          <p className="ab__lede">AirFx is an experimental visual-effects platform designed for transforming images and videos through creative digital tools, distortion, textures, motion and interactive visual experiments.</p>
        </Section>

        <Section n={2} id="info" label="Info" aside={<p className="mono">Runs in the browser<br />Installable as an app<br />Works offline once loaded</p>}>
          <p>A creative playground for image and video processing, combining experimental effects, AI-powered tools and customizable visual workflows.</p>
          <p className="muted">Every effect renders on your own device. Your pictures and videos are not uploaded unless you choose to save them to your account.</p>
        </Section>

        <Section n={3} id="features" label="Features" aside={<p className="mono">{LIBRARY.length} tools in total<br />Image · Video · Audio</p>}>
          <ul className="ab__features">
            {FEATURES.map(([t, d], i) => <li key={t}><span className="mono">{String(i + 1).padStart(2, '0')}</span><strong>{t}</strong><span>{d}</span></li>)}
          </ul>
        </Section>

        <Section n={4} id="creator" label="Created By" aside={<p className="mono">{CREATOR.from}</p>}>
          <p className="ab__name">{CREATOR.name}</p>
          <p className="ab__role">{CREATOR.role}</p>
          <p className="ab__from">From {CREATOR.from}.</p>
          <p className="muted">AirFx is designed, built and maintained independently, as a place to experiment with how images move, break and transform.</p>
          <p className="ab__credit">Created by {CREATOR.name}, {CREATOR.from}.</p>
        </Section>

        <Section n={5} id="contact" label="Contact" aside={<p className="mono">Feedback · Bugs<br />Collabs · Ideas</p>}>
          <p>Feedback, bug reports, collaborations and feature suggestions are all welcome.</p>
          <ul className="ab__topics">
            {TOPICS.map((t) => (
              <li key={t}>
                {CONTACT.email ? <a href={mail(t)}>{t} <span aria-hidden>↗</span></a> : <span>{t}</span>}
              </li>
            ))}
          </ul>
          {CONTACT.email && <p><a className="ab__link" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></p>}
          {CONTACT.url && <p><a className="ab__link" href={CONTACT.url} target="_blank" rel="noreferrer">{CONTACT.urlLabel} ↗</a></p>}
          {!CONTACT.email && !CONTACT.url && <p className="muted">Official contact details will be published here soon.</p>}
          <p className="muted small">For a bug, mention your device, browser, the effect you used and what happened. Please do not send passwords or private files.</p>
        </Section>

        <Section n={6} id="legal" label="Legal" aside={<p className="mono">© {COPYRIGHT_YEAR} {CREATOR.name}</p>}>
          <div className="ab__legal">
            <details>
              <summary>Privacy Policy</summary>
              <p className="muted">The full privacy policy has not been published yet. Until it is, this is how AirFx handles data today:</p>
              <ul>
                <li>Effects, AI analysis and exports run in your browser. Media you open is not sent to AirFx.</li>
                <li>With an account, AirFx stores your email address, display name, and the projects, presets and media you choose to save. Only your account can read them.</li>
                <li>When something breaks, the app may send a short error report (the error text and app version, never media or project content).</li>
                <li>AI models are downloaded from their public hosts the first time you load one, and kept in your browser.</li>
              </ul>
            </details>
            <details>
              <summary>Terms Of Use</summary>
              <p className="muted">The terms of use have not been published yet. They will appear here before paid plans start.</p>
            </details>
            <details>
              <summary>Copyright</summary>
              <p>© {COPYRIGHT_YEAR} {CREATOR.name}. All rights reserved. The AirFx name, wordmark, interface and source code may not be copied or redistributed without permission.</p>
              <p className="muted">The pictures and videos you make with AirFx are yours. The sample photographs are public-domain or CC0 images from Wikimedia Commons, credited in the app.</p>
            </details>
            <details>
              <summary>Usage Information</summary>
              <ul>
                <li>Guests can use the full editor; their work is saved in the browser on that device.</li>
                <li>Every account is on the Free plan. Pro and Studio plans are planned; payments are not active.</li>
                <li>Only use media you have the right to edit and share.</li>
              </ul>
            </details>
          </div>
        </Section>

        <footer className="ab__foot">
          <Wordmark size="lg" />
          <p className="mono">Created by {CREATOR.name}, {CREATOR.from}. · AirFx v{__APP_VERSION__}</p>
          <button className="pill pill--lime" onClick={onClose}>Back To AirFx</button>
        </footer>
      </div>
    </div>
  );
}
