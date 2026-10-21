"""A terminal on a tmux session: attaches a client in an 80x24 pty and sends it what a terminal would, in order.

Usage: terminal.py <socket> <session> <steps>, the steps a JSON list of [text, seconds to wait after it].
"""
import fcntl
import json
import os
import pty
import select
import struct
import sys
import termios
import time

socket, session, steps = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
pid, fd = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    # A test run inside tmux is not attaching a session in a session.
    os.environ.pop('TMUX', None)
    os.execvp('tmux', ['tmux', '-L', socket, 'attach', '-t', f'={session}'])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))


shown = b''


def read_for(seconds):
    global shown
    end = time.time() + seconds
    while time.time() < end:
        if select.select([fd], [], [], 0.02)[0]:
            try:
                got = os.read(fd, 65536)
            except OSError:
                got = b''
            if not got:
                gone()
            shown = (shown + got)[-2000:]


def gone():
    sys.exit(f'the client is gone, having shown: {shown!r}')


read_for(0.8)
for text, wait in steps:
    try:
        os.write(fd, text.encode())
    except OSError:
        gone()
    read_for(wait)
os.kill(pid, 9)
os.waitpid(pid, 0)
