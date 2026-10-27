import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import { faGithub, faLinkedin } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// Vite bundles the icon styles; no runtime stylesheet injection or CDN is needed.
config.autoAddCss = false;

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-content">
        <span>Created by William Dickerson</span>
        <span className="site-footer-links">
          <a href="https://github.com/wdickerson" aria-label="William Dickerson on GitHub">
            <FontAwesomeIcon icon={faGithub} aria-hidden="true" focusable="false" />
          </a>
          <a href="https://www.linkedin.com/in/wdickerson08" aria-label="William Dickerson on LinkedIn">
            <FontAwesomeIcon icon={faLinkedin} aria-hidden="true" focusable="false" />
          </a>
        </span>
        <span className="site-footer-brand">
          <span aria-hidden="true">|</span>{' '}
          <a href="https://littleapp.io">littleapp.io</a>
        </span>
      </div>
    </footer>
  );
}