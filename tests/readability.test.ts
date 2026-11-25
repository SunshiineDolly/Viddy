import {test} from 'node:test'
import assert from 'node:assert/strict'
import {decode,empty} from '../src/library.ts'

test('existing libraries and invalid interface sizes use the larger readable default',()=>{
 assert.equal(empty().settings.interfaceSize,'large')
 for(const settings of [{},{interfaceSize:'tiny'},{interfaceSize:500}])assert.equal(decode({version:1,settings}).settings.interfaceSize,'large')
})

test('chosen interface size survives saving and reopening the library',()=>{
 for(const interfaceSize of ['standard','large','extra-large'] as const){
  const library=empty();library.settings.interfaceSize=interfaceSize
  assert.equal(decode(JSON.parse(JSON.stringify(library))).settings.interfaceSize,interfaceSize)
 }
})
