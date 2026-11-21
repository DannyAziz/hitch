// How a harness process runs: detached, supervised, and read from a file.
//
// A harness turn spans several of the agent's steps (one per row), and may
// outlive a reload of this mod, so the harness is not a child of any one
// step's dispatch. Instead:
//
// LAUNCH (`$.process.run`, returns at once): a perl launcher forks a
// supervisor in a session of its own and exits, printing the supervisor's
// pid. The supervisor reads the prompt from <dir>/input, sends the
// harness's stdout to <dir>/out and stderr to <dir>/err, forks the harness
// into a process group of its own, and waits. When the harness exits it
// writes <dir>/exit (`code N` or `signal N`). When it is told to stop
// (TERM/INT/HUP), or the Claude Code process it watches is gone, it walks
// the harness's process tree while the harness is still alive, signals every
// descendant and every process group led by one (Codex runs each command in
// a group of its own, so killing Codex alone leaves them running), SIGKILLs
// what is left after ~2 s, and writes <dir>/exit `stopped`.
//
// TWO-WAY (ACP): launched with stdin mode `tail`, the supervisor keeps a
// pipe to the server's stdin and forwards every complete line appended to
// <dir>/in (the mod appends JSON-RPC messages there, see appendArgv); the
// server's stdout still goes to <dir>/out. The pipe lives with the
// supervisor, not with any step or copy of the mod, so the conversation
// survives both. Nothing closes it but the supervisor stopping.
//
// READ (`$.process.spawn`, one per step): a perl reader prints <dir>/out's
// complete lines after the first N, follows the file, and reports on stderr:
// `__hitch_idle__ S` every few seconds while nothing new arrived for S seconds,
// `__hitch_timeout__ S` (and exits) once that reaches the idle limit, and
// `__hitch_exit__ <exit file>` (and exits) once the harness has ended and every
// line was printed. The step waits on this child, which costs its hook budget
// nothing, and closing it (end of step, stop) leaves the harness running.

export const IDLE_TAG = '__hitch_idle__'
export const TIMEOUT_TAG = '__hitch_timeout__'
export const EXIT_TAG = '__hitch_exit__'

const LAUNCHER = String.raw`
use strict; no warnings; use POSIX qw(WNOHANG _exit setsid);
my $dir = shift @ARGV;
my $tail = shift(@ARGV) eq 'tail';
# The Claude Code process to watch: the outermost of the claude processes
# directly above us (the hooks worker may be one of them, and it is
# replaced at a reload; the session's own process is not).
my ($p, $watch, $seen) = (getppid(), getppid(), 0);
for (1 .. 12) {
  my $l = qx(ps -o ppid=,command= -p $p); my ($pp, $cmd) = $l =~ /^\s*(\d+)\s+(.*)$/ or last;
  if ($cmd =~ /claude/i) { $watch = $p; $seen = 1 } elsif ($seen) { last }
  last if $pp <= 1; $p = $pp;
}
my $sup = fork(); if (!defined $sup) { print STDERR "fork: $!\n"; exit 1 }
if ($sup) { print "$sup\n"; exit 0 }
setsid();
my ($pr, $pw);
if ($tail) { pipe($pr, $pw) or do { print STDERR "pipe: $!\n"; _exit(1) }; open STDIN, '<&', $pr }
else { open STDIN, '<', "$dir/input" or open STDIN, '<', '/dev/null' }
open STDOUT, '>>', "$dir/out"; open STDERR, '>>', "$dir/err";
$SIG{PIPE} = 'IGNORE';
my $pid = fork();
if (!defined $pid) { print STDERR "fork: $!\n"; _exit(1) }
if ($pid == 0) { close $pw if $pw; POSIX::setpgid(0, 0); exec { $ARGV[0] } @ARGV; print STDERR "cannot start $ARGV[0]: $!\n"; _exit(127) }
close STDIN; close $pr if $pr;
if ($pw) { my $o = select($pw); $| = 1; select($o) }
my ($inpos, $inbuf) = (0, '');
sub forward {
  return unless $pw;
  open my $h, '<', "$dir/in" or return;
  seek $h, $inpos, 0; local $/; my $chunk = <$h>; close $h;
  return unless defined $chunk && length $chunk;
  $inpos += length $chunk; $inbuf .= $chunk;
  while ((my $i = index($inbuf, "\n")) >= 0) { print $pw substr($inbuf, 0, $i + 1); $inbuf = substr($inbuf, $i + 1) }
}
sub put { my ($f, $t) = @_; open my $h, '>', "$dir/$f.tmp" or return; print $h $t; close $h; rename "$dir/$f.tmp", "$dir/$f" }
put('pids', "$$ $pid $watch\n");
my %seen;
sub scan {
  my (%kids, %pg);
  for (qx(ps -axo pid=,ppid=,pgid=)) { my ($cp, $pp, $g) = split; next unless defined $g; push @{$kids{$pp}}, $cp; $pg{$cp} = $g }
  my @q = ($pid);
  while (@q) { my $x = shift @q; for my $c (@{$kids{$x} || []}) { $seen{$c} = $pg{$c}; push @q, $c } }
}
sub hit {
  my ($sig) = @_;
  my %groups = ($pid => 1);
  for my $q (keys %seen) { my $g = $seen{$q}; $groups{$g} = 1 if defined $g && ($g == $pid || exists $seen{$g}) }
  kill $sig, -$_ for keys %groups;
  kill $sig, $_ for $pid, keys %seen;
}
my $stop = 0;
$SIG{$_} = sub { $stop = 1 } for qw(TERM INT HUP);
my $checked = time;
while (1) {
  if (waitpid($pid, WNOHANG) == $pid) {
    my $st = $?; put('exit', ($st & 127) ? 'signal ' . ($st & 127) : 'code ' . ($st >> 8)); exit 0;
  }
  last if $stop;
  if (time - $checked >= 2) { $checked = time; last if !kill(0, $watch) }
  forward();
  select(undef, undef, undef, $pw ? 0.05 : 0.25);
}
scan(); hit('TERM');
for (1 .. 8) { select(undef, undef, undef, 0.25); waitpid($pid, WNOHANG); scan() if kill 0, $pid }
hit('KILL'); waitpid($pid, WNOHANG);
put('exit', 'stopped');
exit 0;
`

const READER = String.raw`
use strict; no warnings;
my ($dir, $skip, $idle, $tick) = @ARGV;
$| = 1;
my $out = "$dir/out";
my ($fh, $buf, $n) = (undef, '', 0);
my $last_tick = 0;
sub quiet {
  my @t = grep { defined } ((stat $out)[9], (stat "$dir/pids")[9], (stat "$dir/input")[9]);
  my $m = 0; for (@t) { $m = $_ if $_ > $m }
  return $m ? time - $m : 0;
}
sub pump {
  return 0 unless $fh || open($fh, '<', $out);
  my $got = 0;
  while (1) {
    my $r = sysread($fh, my $chunk, 65536);
    last unless $r;
    $got += $r; $buf .= $chunk;
  }
  while ((my $i = index($buf, "\n")) >= 0) {
    my $line = substr($buf, 0, $i + 1); $buf = substr($buf, $i + 1);
    $n++; print STDOUT $line if $n > $skip;
  }
  return $got;
}
while (1) {
  next if pump();
  if (-e "$dir/exit") {
    pump();
    if (length $buf) { $n++; print STDOUT "$buf\n" if $n > $skip; $buf = '' }
    open my $e, '<', "$dir/exit"; my $how = <$e> // ''; chomp $how;
    print STDERR "${EXIT_TAG} $how\n"; exit 0;
  }
  my $q = quiet();
  if ($q >= $idle) { print STDERR "${TIMEOUT_TAG} $q\n"; exit 0 }
  if ($q >= $tick && time - $last_tick >= $tick) { print STDERR "${IDLE_TAG} $q\n"; $last_tick = time }
  select(undef, undef, undef, 0.2);
}
`

// The launch: `$.process.run` this; its stdout is the supervisor's pid.
// `stdin`: 'file' feeds <dir>/input once; 'tail' keeps a pipe fed from
// <dir>/in for a two-way protocol.
export const launchArgv = (dir: string, argv: readonly string[], stdin: 'file' | 'tail' = 'file'): string[] => [
  '/usr/bin/perl',
  '-e',
  LAUNCHER,
  dir,
  stdin,
  ...argv,
]

// Appends JSON-RPC messages, one per line, to a two-way run's <dir>/in.
export const appendArgv = (dir: string, messages: readonly object[]): string[] => [
  '/bin/sh',
  '-c',
  'printf "%s" "$2" >> "$1/in"',
  'sh',
  dir,
  messages.map(m => `${JSON.stringify(m)}\n`).join(''),
]

// One step's reader: `$.process.spawn` this.
export const readerArgv = (dir: string, skip: number, idleSec: number, tickSec = 5): string[] => [
  '/usr/bin/perl',
  '-e',
  READER,
  dir,
  String(skip),
  String(idleSec),
  String(tickSec),
]

export type ReaderSignal =
  | { kind: 'idle'; seconds: number }
  | { kind: 'timeout'; seconds: number }
  | { kind: 'exit'; how: string }

// The reader's stderr lines, one at a time.
export function readerSignal(line: string): ReaderSignal | undefined {
  const [tag, ...rest] = line.trim().split(' ')
  const arg = rest.join(' ')
  if (tag === IDLE_TAG) return { kind: 'idle', seconds: Number(arg) || 0 }
  if (tag === TIMEOUT_TAG) return { kind: 'timeout', seconds: Number(arg) || 0 }
  if (tag === EXIT_TAG) return { kind: 'exit', how: arg }
  return undefined
}
