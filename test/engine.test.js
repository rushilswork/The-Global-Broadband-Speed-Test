import test from 'node:test'
import assert from 'node:assert/strict'
import { median, jitterOf, gradeBufferbloat, mbps, metaFromHeaders } from '../public/js/engine.js'

test('median', () => {
  assert.equal(median([]), null)
  assert.equal(median([5]), 5)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
})

test('jitter is the mean absolute difference of consecutive samples', () => {
  assert.equal(jitterOf([]), 0)
  assert.equal(jitterOf([10]), 0)
  assert.equal(jitterOf([10, 20, 10]), 10)
  assert.equal(jitterOf([5, 5, 5]), 0)
})

test('bufferbloat grades', () => {
  assert.equal(gradeBufferbloat(null), null)
  assert.equal(gradeBufferbloat(2), 'A+')
  assert.equal(gradeBufferbloat(29), 'A')
  assert.equal(gradeBufferbloat(30), 'B')
  assert.equal(gradeBufferbloat(150), 'C')
  assert.equal(gradeBufferbloat(300), 'D')
  assert.equal(gradeBufferbloat(900), 'F')
})

test('mbps conversion', () => {
  assert.equal(mbps(12_500_000, 1000), 100) // 12.5 MB in 1s = 100 Mbps
  assert.equal(mbps(1, 0), 0)
})

test('metaFromHeaders tolerates missing headers', () => {
  assert.deepEqual(metaFromHeaders(new Headers()), {})
  assert.equal(metaFromHeaders(new Headers({ 'cf-meta-ip': '1.2.3.4' })).ip, '1.2.3.4')
})
