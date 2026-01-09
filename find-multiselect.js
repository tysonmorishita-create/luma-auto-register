// Paste this into the browser console on the Luma event page
// It will help find the multi-select dropdown element

console.log('=== SEARCHING FOR MULTI-SELECT DROPDOWN ===');

// Method 1: Search by label text
var labelText = 'Which of the below describes you';
var foundLabel = null;
var allText = document.body.innerText || document.body.textContent || '';

if (allText.toLowerCase().indexOf(labelText.toLowerCase()) > -1) {
  console.log('✓ Found label text in page');
  
  // Try to find the label element
  var allElements = document.querySelectorAll('*');
  for (var i = 0; i < allElements.length; i++) {
    var elem = allElements[i];
    var text = (elem.textContent || '').trim();
    if (text.toLowerCase().indexOf(labelText.toLowerCase()) > -1 && 
        text.length < 200) {
      foundLabel = elem;
      console.log('✓ Found label element:', elem);
      console.log('  Tag:', elem.tagName);
      console.log('  Class:', elem.className);
      console.log('  ID:', elem.id);
      console.log('  Full text:', text);
      break;
    }
  }
}

// Method 2: Find input with placeholder "Select one or more"
var inputs = document.querySelectorAll('input');
console.log('\n=== CHECKING ALL INPUTS ===');
console.log('Total inputs found:', inputs.length);

for (var i = 0; i < inputs.length; i++) {
  var inp = inputs[i];
  var placeholder = (inp.placeholder || '').toLowerCase();
  var name = (inp.name || '').toLowerCase();
  var id = (inp.id || '').toLowerCase();
  var type = inp.type || '';
  
  if (placeholder.indexOf('select one or more') > -1 ||
      placeholder.indexOf('select multiple') > -1 ||
      placeholder.indexOf('tick all') > -1 ||
      name.indexOf('which') > -1 ||
      id.indexOf('which') > -1) {
    console.log('\n✓ POTENTIAL MULTI-SELECT INPUT FOUND:');
    console.log('  Index:', i);
    console.log('  Tag:', inp.tagName);
    console.log('  Type:', type);
    console.log('  Placeholder:', inp.placeholder);
    console.log('  Name:', inp.name);
    console.log('  ID:', inp.id);
    console.log('  Value:', inp.value);
    console.log('  Class:', inp.className);
    console.log('  Parent:', inp.parentElement ? inp.parentElement.tagName + ' (class: ' + inp.parentElement.className + ')' : 'none');
    
    // Find label
    var label = inp.closest('label') || 
                document.querySelector('label[for="' + inp.id + '"]') ||
                inp.previousElementSibling;
    if (label) {
      console.log('  Label text:', (label.textContent || '').trim().substring(0, 100));
    }
  }
}

// Method 3: Find by searching for "tick all that apply" text
console.log('\n=== SEARCHING FOR "TICK ALL THAT APPLY" ===');
var tickAllText = 'tick all that apply';
var allTextLower = allText.toLowerCase();
if (allTextLower.indexOf(tickAllText) > -1) {
  console.log('✓ Found "tick all that apply" text');
  
  // Find the element containing this text
  for (var i = 0; i < allElements.length; i++) {
    var elem = allElements[i];
    var text = (elem.textContent || '').toLowerCase();
    if (text.indexOf(tickAllText) > -1 && text.length < 300) {
      console.log('✓ Found element with "tick all that apply":');
      console.log('  Tag:', elem.tagName);
      console.log('  Class:', elem.className);
      console.log('  ID:', elem.id);
      console.log('  Full text:', (elem.textContent || '').trim());
      
      // Try to find nearby input
      var container = elem.closest('div, form, section');
      if (container) {
        var nearbyInput = container.querySelector('input');
        if (nearbyInput) {
          console.log('  Nearby input found:');
          console.log('    Placeholder:', nearbyInput.placeholder);
          console.log('    Name:', nearbyInput.name);
          console.log('    ID:', nearbyInput.id);
        }
      }
      break;
    }
  }
}

// Method 4: Check all divs with select/dropdown classes
console.log('\n=== CHECKING DIVS WITH SELECT/DROPDOWN CLASSES ===');
var selectDivs = document.querySelectorAll('[class*="select"], [class*="Select"], [class*="dropdown"], [class*="Dropdown"]');
console.log('Found', selectDivs.length, 'divs with select/dropdown classes');

for (var i = 0; i < Math.min(selectDivs.length, 20); i++) {
  var div = selectDivs[i];
  var text = (div.textContent || '').toLowerCase();
  if (text.indexOf('which of') > -1 || text.indexOf('tick all') > -1 || text.indexOf('select one or more') > -1) {
    console.log('\n✓ POTENTIAL MULTI-SELECT DIV FOUND:');
    console.log('  Index:', i);
    console.log('  Class:', div.className);
    console.log('  ID:', div.id);
    console.log('  Text:', (div.textContent || '').trim().substring(0, 150));
    console.log('  Has input inside:', div.querySelector('input') !== null);
    if (div.querySelector('input')) {
      var innerInput = div.querySelector('input');
      console.log('    Input placeholder:', innerInput.placeholder);
      console.log('    Input name:', innerInput.name);
      console.log('    Input ID:', innerInput.id);
    }
  }
}

console.log('\n=== SUMMARY ===');
console.log('Please copy and paste the output above so I can see how to detect the multi-select dropdown!');

