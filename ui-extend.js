(function () {
    var el              = document.createElement('style');
    var ICON_NAME_HOVER = 'a[data-name="__name__"]:hover:after { content: "__name__"; }';

    var css = [
        'age',
        'children',
        'emotional',
        'family',
        'intellectual',
        'marriage',
        'money',
        'physical',
        'purchase',
        'relationships',
        'risks',
        'school',
        'social',
        'stats',
        'sunset',
        'work'
    ]
        .map(ICON_NAME_HOVER.replace.bind(ICON_NAME_HOVER, /__name__/g))
        .join('\n');

    el.innerHTML = css;
    document.body.appendChild(el);
})();