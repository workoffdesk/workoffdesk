// The CLI speaks the Mac's language; tests read its English wording on any machine.
process.env.LANG = 'en_US.UTF-8';
delete process.env.LC_ALL;
delete process.env.LC_MESSAGES;
