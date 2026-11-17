const test = require('node:test');
const assert = require('node:assert/strict');
const {parse} = require('../client-source-code/client-development/browser/main/scripts/irc/protocol');
const cases = require('./fixtures/parser-tests/msg-split.json');

test('IRC documentation parser corpus', () =>
{
    for (const example of cases.tests)
    {
        const result = parse(example.input);
        assert.ok(result, example.input);
        assert.equal(result.command, example.atoms.verb.toUpperCase(), example.input);
        assert.equal(result.prefix, example.atoms.source || '', example.input);
        assert.deepEqual(result.params, example.atoms.params || [], example.input);
        assert.deepEqual({...result.tags}, example.atoms.tags || {}, example.input);
    }
});

test('malformed packets and special tag keys remain data', () =>
{
    for (const line of ['', ' ', ':prefix', ':prefix ', '@only', 'PRIVMSG x :hello\r\nQUIT', ': NICK x'])
    {
        assert.equal(parse(line), null, line);
    }
    const packet = parse('@__proto__=text;constructor=test;case=a;Case=b;end=abc\\ PING :x');
    assert.equal(packet.tags.__proto__, 'text');
    assert.equal(packet.tags.constructor, 'test');
    assert.equal(packet.tags.case, 'a');
    assert.equal(packet.tags.Case, 'b');
    assert.equal(packet.tags.end, 'abc');
    assert.equal(Object.getPrototypeOf(packet.tags), null);
});
