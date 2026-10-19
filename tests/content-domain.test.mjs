import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFields,metadataDiff} from '../client/domain/content.mjs';

test('book create supports both documented single-choice representations',()=>{
  for(const MediaType of ['book',['book']])assert.deepEqual(validateFields('BookMediaItem',{Name:'book',DisplayName:'Book',MediaType},{create:true}).MediaType,MediaType);
  assert.throws(()=>validateFields('BookMediaItem',{Name:'book',DisplayName:'Book',MediaType:['movie']},{create:true}),error=>error.code==='invalid_field');
});
test('calendar validation rejects date rollovers and accepts leap days and zoned dates',()=>{
  for(const ChronologicalDate of ['2025-02-29','2024-02-30','2024-04-31'])assert.throws(()=>validateFields('TimelineEntry',{ChronologicalDate}),error=>error.code==='invalid_field');
  for(const ChronologicalDate of ['2024-02-29','2024-03-01T00:00:00+05:00',null])assert.ok(Object.hasOwn(validateFields('TimelineEntry',{ChronologicalDate}),'ChronologicalDate'));
});

test('DateTime input rejects unsupported years, clock values and offset boundaries',()=>{
  for(const ChronologicalDate of ['0000-01-01','2024-03-01T24:00:00Z','2024-03-01T23:60:00Z','2024-03-01T23:59:60Z','2024-03-01T00:00:00+14:01','2024-03-01T00:00:00-15:00','0001-01-01T00:00:00+00:01','9999-12-31T23:59:59-00:01','2024-03-01T00:00:00.1234Z','2024-03-01T00:00:00.1234567+05:00'])assert.throws(()=>validateFields('TimelineEntry',{ChronologicalDate}),error=>error.code==='invalid_field');
  for(const ChronologicalDate of ['0001-01-01','9999-12-31T23:59:59Z','2024-03-01T00:00:00+14:00','2024-03-01T00:00:00-14:00'])assert.ok(validateFields('TimelineEntry',{ChronologicalDate}).ChronologicalDate);
});

test('date-only, local-form and zoned datetime proposals normalize to UTC without mutating input',()=>{
  for(const [ReleaseDate,expected] of [['2024-02-29','2024-02-29T00:00:00Z'],['2024-03-01T12:30','2024-03-01T12:30:00Z'],['2024-03-01T00:00:00+05:00','2024-02-29T19:00:00Z'],['2024-03-01T23:30:00-05:00','2024-03-02T04:30:00Z'],['2024-03-01T00:00:00.125+05:30','2024-02-29T18:30:00.125Z'],[null,null]]){
    const fields={ReleaseDate};assert.equal(validateFields('MediaItem',fields).ReleaseDate,expected);assert.equal(fields.ReleaseDate,ReleaseDate);
    const proposal={fields,sources:[{url:'https://openlibrary.org/works/OL27448W',confidence:0.5,note:'Synthetic domain validation proposal.'}]};
    assert.equal(metadataDiff({Type:'MediaItem'},proposal).fields.ReleaseDate,expected);assert.equal(proposal.fields.ReleaseDate,ReleaseDate);
  }
});
test('missing-only enrichment preserves a zero rating while filling unset duration/year',()=>{
  const current={Type:'MediaItem',Rating:0,Year:0,Duration:0};
  const proposal={fields:{Rating:9,Year:1999,Duration:136},sources:[{url:'https://www.themoviedb.org/movie/603',confidence:0.85,note:'Provider metadata; rating is not an editorial override.'}]};
  assert.deepEqual(metadataDiff(current,proposal).fields,{Year:1999,Duration:136});
  assert.deepEqual(metadataDiff(current,proposal,{overwrite:true}).fields,proposal.fields);
});
test('metadata provenance refuses credential-bearing source query URLs',()=>{
  assert.throws(()=>metadataDiff({Type:'MediaItem'},{fields:{Description:'Sourced'},sources:[{url:'https://source.example/item?api_key=secret',confidence:0.5,note:'Source'}]}),error=>error.code==='invalid_sources');
});
