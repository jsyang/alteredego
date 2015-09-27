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

            $('body').animate(
                { scrollTop : $lifeMapNext.offset().top },
                600,
                function () {
                    var $img = $lifeMapNext.find('img');

                    $img
                        .css('transition', 'all 0.6s')
                        .css({
                            'transform' : 'scale(16,16)',
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