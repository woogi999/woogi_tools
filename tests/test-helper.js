import 'qunit/qunit/qunit.css';
import '../app/styles/app.scss';
import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';
import { rootElement } from './helpers/index.js';

// Starts QUnit once every test module is loaded (see tests/index.html).
export function start() {
  setup(QUnit.assert, { getRootElement: rootElement });
  QUnit.config.testTimeout = 60000;
  // Under `npm test`, tests/run.mjs gives the page these two functions and
  // prints what they report.
  if (window.reportTest) {
    QUnit.on('testEnd', (test) =>
      window.reportTest({
        module: test.fullName.slice(0, -1).join(' > '),
        name: test.name,
        status: test.status,
        errors: test.errors.map((e) =>
          [e.message, e.stack].filter(Boolean).join('\n'),
        ),
      }),
    );
    QUnit.on('runEnd', () => window.reportEnd());
  }
  QUnit.start();
}
