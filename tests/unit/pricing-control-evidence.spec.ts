import { test, expect } from '@playwright/test';
import { inspectPricingSaveControl } from '../../pricing/control-evidence';

const callback=(id:string)=>"playSound('neutral_click');Ajax('set_ticket_prices.php?e='+$('#eTicket').val()+'&b='+$('#bTicket').val()+'&f='+$('#fTicket').val()+'&id="+id+"','runme',this);";

test('classifies native Save target as route without persisting the numeric id',()=>{
  const r=inspectPricingSaveControl(callback('33272938'),'22316469','33272938');
  expect(r).toEqual({
    endpointVerified:true,
    target:'route',
    targetMatchesContext:true,
    shape:"playSound('neutral_click');Ajax('set_ticket_prices.php?e='+$('#eTicket').val()+'&b='+$('#bTicket').val()+'&f='+$('#fTicket').val()+'&id=#','runme',this);"
  });
});

test('classifies native Save target as aircraft when matching aircraft identity',()=>{
  expect(inspectPricingSaveControl(callback('22316469'),'22316469','33272938')).toMatchObject({
    endpointVerified:true,target:'aircraft',targetMatchesContext:true
  });
});

test('unknown target remains verified endpoint but cannot authorize a mutation',()=>{
  expect(inspectPricingSaveControl(callback('999'),'22316469','33272938')).toMatchObject({
    endpointVerified:true,target:'other',targetMatchesContext:false
  });
});

[
  "window.mutations++",
  "playSound('neutral_click');Ajax('set_ticket_prices.php?e=1&b=2&f=3&id=33272938','runme',this);",
  "playSound('neutral_click');Ajax('other.php?e='+$('#eTicket').val()+'&b='+$('#bTicket').val()+'&f='+$('#fTicket').val()+'&id=33272938','runme',this);"
].forEach((raw,index)=>test(`rejects non-native Save callback ${index}`,()=>{
  expect(inspectPricingSaveControl(raw,'22316469','33272938')).toMatchObject({
    endpointVerified:false,target:'unavailable',targetMatchesContext:false
  });
}));
