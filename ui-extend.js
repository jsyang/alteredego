(function addLifeMapHoverStyles() {
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

(function bindKeyPress() {
    document.onkeypress = function (e) {
        var char = String.fromCharCode(e.which);
        console.log(char);
        var el   = document.querySelectorAll('[accesskey="' + char + '"');

        if (char === 's') {
            document.querySelector('a[data-name="stats"]').click();
            return;
        } else if (char === 'p') {
            speak();
            return;
        } else if (char === 'a') {
            document.querySelector('a[data-name="age"]').click();
            return;
        } else if (char === 'n' && el[0].getAttribute('data-name')) {
            // Zoom in and go
            var $lifeMapNext = $('#main table a[accesskey="n"]');
            $lifeMapNext.addClass('active');

            $('body').animate(
                { scrollTop : $lifeMapNext.offset().top },
                600,
                function () {
                    var $img = $lifeMapNext.find('img');

                    $img
                        .css('transition', 'all 0.6s')
                        .css({
                            'transform' : 'scale(8,8)',
                            'opacity'   : 0.2,
                            'z-index'   : 1
                        });

                    setTimeout(function () {el[0].click();}, 600);
                }
            );

            return;
        }

        if (el.length > 1) {
            console.log('uh oh', el);
        } else if (el.length === 1) {
            el[0].click();
        }
    }
})();

(function addTextToSpeech() {
    function getVoice(voicename) {
        return speechSynthesis
            .getVoices()
            .filter(function (ssv) { return ssv.name === voicename; })[0];
    }

    function speak() {
        speechSynthesis.cancel();
        var phrase   = new SpeechSynthesisUtterance(document.querySelector('#main #text').innerText);
        phrase.voice = getVoice('Google UK English Male');
        phrase.pitch = 0;
        speechSynthesis.speak(phrase);
    }

    window.speak = speak;

    //speechSynthesis.getVoices().map(function(ssv){ return ssv.name; });
})();

function addStatDiffTable() {
    var STAT_HUMAN_READABLE = {
        "ph" : 'Physical',
        "in" : 'Intellectual',
        "vc" : 'Vocational',
        "ca" : 'Calmness',
        "cn" : 'Confidence',
        "ex" : 'Expressiveness',
        "fm" : 'Familial',
        "gn" : 'Gentleness',
        "hp" : 'Happiness',
        "sc" : 'Social',
        "th" : 'Thoughtfulness',
        "tr" : 'Trustworthiness'
    };

    var $statDiff = $('<div class="stat_diff"/>');
    var diffHTML  = Object.keys(lastStats)
        .map(function (key) {
            if (key in STAT_HUMAN_READABLE && stats[key] != lastStats[key]) {
                return {
                    name  : key,
                    value : lastStats[key] - stats[key]
                };
            }
        }
    )
        .
        filter(Boolean)
        .map(function (statdiff) {
            var name  = STAT_HUMAN_READABLE[statdiff.name];
            var value = statdiff.value;
            var change;

            if (statdiff.value > 0) {
                value  = '+' + value + '%';
                change = 'positive';
            } else {
                value  = value + '%';
                change = 'negative';
            }
            return [
                '<div class="' + change + '">',
                '<span class="name">' + name + '</span>',
                '<span class="value">' + value + '</span>',
                '</div>'
            ].join('');
        })
        .join('\n');
    $statDiff.html(diffHTML);
    $(document.body).append($statDiff);
}