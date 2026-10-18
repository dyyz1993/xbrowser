import os
import subprocess
import sys

port, profile, chromium, user_agent, log = sys.argv[1:]
with open(log, 'ab', buffering=0) as output:
    child = subprocess.Popen(
        [
            chromium,
            '--headless',
            f'--remote-debugging-port={port}',
            f'--user-data-dir={profile}',
            f'--user-agent={user_agent}',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-session-crashed-bubble',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--window-size=1440,900',
            'about:blank',
        ],
        stdin=subprocess.DEVNULL,
        stdout=output,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        env={**os.environ, 'HOME': os.environ.get('XBROWSER_REAL_HOME', os.environ['HOME'])},
    )
    print(child.pid, flush=True)
