// Shared Property Inspector logic for all three actions.
// The host action UUID is provided per-page via window.ACTION_UUID.

let form = null;
let ACTION_SETTING = {};

// Language files (<lang>.json) live at the plugin root, one level above pi/.
// The SDK default ('../../') would look outside the plugin folder.
$UD.localPathPrefix = '../';

$UD.connect(window.ACTION_UUID);

$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');
  document.querySelector('.udpi-wrapper').classList.remove('hidden');

  form.addEventListener(
    'input',
    Utils.debounce(() => {
      const value = Utils.getFormValue(form);
      ACTION_SETTING = { ...ACTION_SETTING, ...value };
      $UD.sendParamFromPlugin(ACTION_SETTING);
    })
  );
});

// Initial settings can arrive via either event depending on timing.
$UD.onAdd((jsn) => {
  if (jsn && jsn.param) applySettings(jsn.param);
});
$UD.onParamFromApp((jsn) => {
  if (jsn && jsn.param) applySettings(jsn.param);
});

function applySettings(params) {
  ACTION_SETTING = params || {};
  if (!ACTION_SETTING.duration) ACTION_SETTING.duration = '5';
  if (form) Utils.setFormValue(ACTION_SETTING, form);
}
