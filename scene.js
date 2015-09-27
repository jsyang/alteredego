function Scene(name, stats, nav, options) {
    if (!name)name = "";
    if (!stats)stats = {};
    this.name            = name;
    this.stats           = stats;
    this.temps           = { choice_reuse : "allow", choice_user_restored : false };
    this.nav             = nav;
    options              = options || {};
    this.debugMode       = options.debugMode || false;
    this.secondaryMode   = options.secondaryMode;
    this.saveSlot        = options.saveSlot || "";
    this.lines           = [];
    this.lineNum         = 0;
    this.rollbackLineCoverage();
    this.finished        = false;
    this.labels          = {};
    this.indent          = 0;
    this.prevLine        = "empty";
    this.screenEmpty     = true;
    this.initialCommands = true;
    this.stats.sceneName = name;
    this.stats.scene     = this;
    this.target          = null;
}
Scene.prototype.reexecute          = function reexecute() {
    this.lineNum     = this.stats.testEntryPoint || 0;
    this.finished    = 0;
    this.indent      = this.getIndent(this.lines[this.lineNum]);
    this.prevLine    = "empty";
    this.screenEmpty = true;
    this.execute();
};
Scene.prototype.printLoop          = function printLoop() {
    var line;
    for (; !this.finished && this.lineNum < this.lines.length; this.lineNum++) {
        line = this.lines[this.lineNum];
        if (!trim(line)) {
            this.paragraph();
            continue;
        }
        var indent = this.getIndent(line);
        if (indent > this.indent) {
            if (/\s*\*comment\b/.test(line))continue;
            throw new Error(this.lineMsg() + "increasing indent not allowed, expected " + this.indent + " was " + indent);
        } else if (indent < this.indent) {
            this.dedent(indent);
        }
        if (this.temps.fakeChoiceLines && this.temps.fakeChoiceLines[this.lineNum]) {
            this.rollbackLineCoverage();
            this.lineNum = this.temps.fakeChoiceEnd;
            this.rollbackLineCoverage();
            delete this.temps.fakeChoiceEnd;
            delete this.temps.fakeChoiceLines;
            continue;
        }
        this.indent = indent;
        if (!this.runCommand(line)) {
            if (/^\s*#/.test(line)) {
                if (this.temps.fakeChoiceEnd) {
                    this.rollbackLineCoverage();
                    this.lineNum = this.temps.fakeChoiceEnd;
                    this.rollbackLineCoverage();
                    delete this.temps.fakeChoiceEnd;
                    delete this.temps.fakeChoiceLines;
                    continue;
                } else {
                    throw new Error(this.lineMsg() + "It is illegal to fall out of a *choice statement; you must *goto or *finish before the end of the indented block.");
                }
            }
            this.prevLine    = "text";
            this.screenEmpty = false;
            this.printLine(trim(line));
            printx(' ', this.target);
        }
    }
    this.rollbackLineCoverage();
    if (!this.finished) {
        this.autofinish();
    }
    this.save(null, "temp");
    if (this.skipFooter) {
        this.skipFooter = false;
    } else {
        printFooter();
    }
};
Scene.prototype.dedent             = function dedent(newDent) {};
Scene.prototype.printLine          = function printLine(line, parent) {
    if (!line)return null;
    line = this.replaceVariables(line);
    if (!parent)parent = this.target;
    return printx(line, parent);
};
Scene.prototype.replaceVariables   = function (line) {
    if (!line.replace)line = String(line);
    var self       = this;
    line           = line.replace(/\$(\!?\!?)\{([a-zA-Z][_\w]*)\}/g, function (matched, capitalize, variable) {
        var value = self.getVar(variable);
        if (capitalize == "!") {
            value = "" + value;
            value = value.charAt(0).toUpperCase() + value.slice(1);
        } else if (capitalize == "!!") {
            value = ("" + value).toUpperCase();
        }
        return value;
    });
    var unreplaced = line.search(/\$(\!?)\{/) + 1;
    if (unreplaced) {
        throw new Error(this.lineMsg() + "invalid ${} variable substitution at letter " + unreplaced);
    }
    return line;
};
Scene.prototype.paragraph          = function paragraph() {
    if (this.prevLine == "text") {
        println("", this.target);
        println("", this.target);
    } else if (this.prevLine == "block") {
        println("", this.target);
    }
    this.prevLine = "empty";
};
Scene.prototype.loadSceneFast      = function loadSceneFast(url) {
    if (this.loading)return;
    this.loading = true;
    var result;
    if (window.cachedResults && window.cachedResults[this.name]) {
        result = window.cachedResults[this.name];
        return this.loadLinesFast(result.crc, result.lines, result.labels);
    } else if (typeof allScenes != "undefined") {
        result = allScenes[this.name];
        return this.loadLinesFast(result.crc, result.lines, result.labels);
    }
    startLoading();
    if (!url) {
        url = Scene.baseUrl + "/" + this.name.replace(/ /g, "_") + ".txt.json";
    }
    var xhr                = findXhr();
    xhr.open("GET", url, true);
    var self               = this;
    var done               = false;
    xhr.onreadystatechange = function () {
        if (done)return;
        if (xhr.readyState != 4)return;
        if (xhr.status == 403) {
            try {
                var err = JSON.parse(xhr.responseText);
                if (err.error == "not registered") {
                    return isRegistered(function (registered) {
                        if (registered) {
                            logout();
                            loginDiv();
                        }
                        return clearScreen(function () {loginForm(main, 0, "Please sign in to access this part of the game.", function () {clearScreen(loadAndRestoreGame);});});
                    });
                }
            } catch (e) {
            }
        }
        done = true;
        var result;
        try {
            result = jsonParse(xhr.responseText);
        } catch (e) {
            if (window.console)console.error(e, e.stack);
        }
        if (window.isWeb && (xhr.status != 200 || !result)) {
            var status = xhr.status;
            if (status == 200 || !status)status = "network";
            main.innerHTML = "<p>Our apologies; there was a " + status + " error while loading game data." + "  Please refresh your browser now; if that doesn't work, please click the Restart button and email " + getSupportEmail() + " with details.</p>" + " <p><button onclick='window.location.reload();'>Refresh Now</button></p>";
            return;
        } else if (xhr.responseText === "") {
            throw new Error("Couldn't load " + url + "\nThe file is probably missing or empty.");
        }
        if (!window.cachedResults)window.cachedResults = {};
        cachedResults[self.name] = result;
        self.loadLinesFast(result.crc, result.lines, result.labels);
    };
    if (isIE) {
        xhr.send(null);
    } else {
        try {
            xhr.send(null);
        } catch (e) {
            if (window.location.protocol == "file:" && !window.isMobile) {
                if (/Chrome/.test(navigator.userAgent)) {
                    window.onerror("We're sorry, Google Chrome has blocked ChoiceScript from functioning.  (\"file:\" URLs cannot " + "load files in Chrome.)  ChoiceScript works just fine in Chrome, but only on a published website like " + "choiceofgames.com.  For the time being, please try another browser like Mozilla Firefox.");
                    return;
                }
            }
            window.onerror("Couldn't load URL: " + url + "\n" + e);
        }
    }
};
Scene.prototype.loadLinesFast      = function loadLinesFast(crc, lines, labels) {
    this.checkSum(crc);
    this.lines   = lines;
    this.labels  = labels;
    this.loading = false;
    this.loaded  = true;
    var self     = this;
    if (this.executing) {
        safeCall(this, function () {
            doneLoading();
            self.execute();
        });
    }
};
Scene.prototype.loadScene          = function loadScene(url) {
    if (this.loading)return;
    this.loading = true;
    startLoading();
    if (!url) {
        url = Scene.baseUrl + "/" + this.name + ".txt";
    }
    var xhr                = findXhr();
    xhr.open("GET", url, true);
    var self               = this;
    var done               = false;
    xhr.onreadystatechange = function () {
        if (done)return;
        if (xhr.readyState != 4)return;
        done = true;
        if (xhr.status == 403) {
            try {
                var err = JSON.parse(xhr.responseText);
                if (err.error == "not registered") {
                    return isRegistered(function (registered) {
                        if (registered) {
                            logout();
                            loginDiv();
                        }
                        return clearScreen(function () {loginForm(main, 0, "Please sign in to access this part of the game.", function () {clearScreen(loadAndRestoreGame);});});
                    });
                }
            } catch (e) {
            }
        }
        if (window.isWeb && xhr.status != 200) {
            var status     = xhr.status || "network";
            main.innerHTML = "<p>Our apologies; there was a " + status + " error while loading game data." + "  Please refresh your browser now; if that doesn't work, please email " + getSupportEmail() + " with details.</p>" + " <p><button onclick='window.location.reload();'>Refresh Now</button></p>";
            return;
        } else if (xhr.responseText === "") {
            throw new Error("Couldn't load " + url + "\nThe file is probably missing or empty.");
        }
        var result   = xhr.responseText;
        scene        = result;
        scene        = scene.replace(/\r/g, "");
        this.loading = false;
        self.loadLines(scene);
        if (self.executing) {
            safeCall(self, function () {
                doneLoading();
                self.execute();
            });
        }
    };
    if (isIE) {
        xhr.send(null);
    } else {
        try {
            xhr.send(null);
        } catch (e) {
            if (window.location.protocol == "file:" && !window.isMobile) {
                if (/Chrome/.test(navigator.userAgent)) {
                    window.onerror("We're sorry, Google Chrome has blocked ChoiceScript from functioning.  (\"file:\" URLs cannot " + "load files in Chrome.)  ChoiceScript works just fine in Chrome, but only on a published website like " + "choiceofgames.com.  For the time being, please try another browser like Mozilla Firefox.");
                    return;
                } else if (e.code === 1012) {
                    window.onerror("Couldn't load scene file: " + url + "\nThe file is probably missing.");
                    return;
                }
            }
            window.onerror("Couldn't load URL: " + url + "\n" + e);
        }
    }
};
Scene.prototype.checkSum           = function checkSum(crc) {
    if (this.temps.choice_crc) {
        if (this.temps.choice_crc != crc) {
            var userRestored = this.temps.choice_user_restored || false;
            this.temps       = { choice_reuse : "allow", choice_user_restored : userRestored, choice_crc : crc };
            this.lineNum     = 0;
            this.indent      = 0;
        }
    } else {
        this.temps.choice_crc = crc;
    }
};
Scene.prototype.loadLines          = function loadLines(str) {
    var crc     = crc32(str);
    this.checkSum(crc);
    this.lines  = str.split('\n');
    this.parseLabels();
    this.loaded = true;
};
Scene.prototype.execute            = function execute() {
    if (!this.loaded) {
        this.executing = true;
        if (Scene.generatedFast || (typeof generatedFast != "undefined" && generatedFast) || typeof allScenes != 'undefined') {
            this.loadSceneFast();
        } else {
            this.loadScene();
        }
        return;
    }
    if (this.nav)this.nav.repairStats(stats);
    doneLoading();
    if (typeof this.targetLabel != "undefined") {
        var label = this.targetLabel.label.toLowerCase();
        if (typeof(this.labels[label]) != "undefined") {
            this.lineNum = this.labels[label];
            this.indent  = this.getIndent(this.lines[this.lineNum]);
            delete this.targetLabel;
        } else {
            throw new Error(this.targetLabel.origin + " line " + (this.targetLabel.originLine + 1) + ": " + this.name + " doesn't contain label " + label);
        }
    }
    this.printLoop();
};
Scene.prototype.parseLabels        = function parseLabels() {
    var lineLength = this.lines.length;
    var oldLineNum = this.lineNum;
    for (this.lineNum = 0; this.lineNum < lineLength; this.lineNum++) {
        this.rollbackLineCoverage();
        var line   = this.lines[this.lineNum];
        var result = /^(\s*)\*(\w+)(.*)/.exec(line);
        if (!result)continue;
        var indentation = result[1];
        var indent      = indentation.length;
        var command     = result[2].toLowerCase();
        var data        = trim(result[3]);
        if ("label" == command) {
            data = data.toLowerCase();
            if (/\s/.test(data))throw new Error(this.lineMsg() + "label '" + data + "' is not allowed to contain spaces");
            if (this.labels.hasOwnProperty(data)) {
                throw new Error(this.lineMsg() + "label '" + data + "' already defined on line " + (this.labels[data] * 1 + 1));
            }
            this.labels[data] = this.lineNum;
        }
    }
    this.rollbackLineCoverage();
    this.lineNum = oldLineNum;
};
Scene.prototype.runCommand         = function runCommand(line) {
    var result = /^\s*\*(\w+)(.*)/.exec(line);
    if (!result)return false;
    var command = result[1].toLowerCase();
    var data    = trim(result[2]);
    if (Scene.validCommands[command]) {
        if ("comment" == command)return true;
        if (Scene.initialCommands[command]) {
            if ("startup" != this.name || !this.initialCommands) {
                throw new Error(this.lineMsg() + "Invalid " + command + " instruction, only allowed at the top of startup.txt");
            }
        } else {
            this.initialCommands = false;
        }
        this[command](data);
    } else {
        throw new Error(this.lineMsg() + "Non-existent command '" + command + "'");
    }
    return true;
};
Scene.prototype.choice             = function choice(data) {
    var startLineNum = this.lineNum;
    var groups       = data.split(/ /);
    for (var i = 0; i < groups.length; i++) {
        if (!/^\w*$/.test(groups[i])) {
            throw new Error(this.lineMsg() + "invalid choice group name: " + groups[i]);
        }
    }
    var options   = this.parseOptions(this.indent, groups);
    var self      = this;
    this.renderOptions(groups, options, function (option) {self.standardResolution(option);});
    this.finished = true;
    if (this.fakeChoice) {
        this.temps.fakeChoiceEnd = this.lineNum;
        var fakeChoiceLines      = {};
        for (i = 0; i < options.length; i++) {
            fakeChoiceLines[options[i].line - 1] = 1;
        }
        this.temps.fakeChoiceLines = fakeChoiceLines;
    }
    this.lineNum = startLineNum;
};
Scene.prototype.fake_choice        = function fake_choice(data) {
    this.fakeChoice = true;
    this.choice(data, true);
    delete this.fakeChoice;
};
Scene.prototype.standardResolution = function (option) {
    var self     = this;
    self.lineNum = option.line;
    self.indent  = self.getIndent(self.nextNonBlankLine(true));
    if (option.reuse && option.reuse != "allow")self.temps.choice_used[option.line - 1] = 1;
    if (this.nav)this.nav.bugLog.push("#" + (option.line + 1) + " " + option.name);
    self.finished = false;
    self.resetPage();
};
Scene.prototype.nextNonBlankLine   = function nextNonBlankLine(includingThisOne) {
    var line;
    var i = this.lineNum;
    if (!includingThisOne)i++;
    while (isDefined(line = this.lines[i]) && !trim(line)) {
        i++;
    }
    return line;
};
Scene.prototype.resetPage          = function resetPage() {
    var self = this;
    clearScreen(function () {
        self.save(function () {});
        self.prevLine    = "empty";
        self.screenEmpty = true;
        self.execute();
    });
};
Scene.prototype.save               = function save(callback, slot) {
    if (this.saveSlot) {
        transferTempStatWrites();
    } else {
        if (!slot) {
            slot = "";
            for (var key in tempStatWrites) {
                if (tempStatWrites.hasOwnProperty(key)) {
                    this.stats[key] = tempStatWrites[key];
                }
            }
            tempStatWrites = {};
        }
        saveCookie(callback, slot, this.stats, this.temps, this.lineNum, this.indent, this.debugMode, this.nav);
    }
};
Scene.prototype["goto"]            = function scene_goto(label) {
    label = label.toLowerCase();
    if (typeof(this.labels[label]) != "undefined") {
        this.lineNum = this.labels[label];
        this.indent  = this.getIndent(this.lines[this.lineNum]);
    } else {
        throw new Error(this.lineMsg() + "bad label " + label);
    }
};
Scene.prototype.gosub              = function scene_gosub(label) {
    if (!this.temps.choice_substack) {
        this.temps.choice_substack = [];
    }
    this.temps.choice_substack.push({ lineNum : this.lineNum, indent : this.indent });
    this["goto"](label);
};
Scene.prototype.gosub_scene        = function scene_gosub_scene(data) {
    if (!this.stats.choice_subscene_stack) {
        this.stats.choice_subscene_stack = [];
    }
    this.stats.choice_subscene_stack.push({
        name    : this.name,
        lineNum : this.lineNum + 1,
        indent  : this.indent,
        temps   : this.temps
    });
    this.goto_scene(data);
};
Scene.prototype["return"]          = function scene_return() {
    var stackFrame;
    if (this.temps.choice_substack && this.temps.choice_substack.length) {
        stackFrame   = this.temps.choice_substack.pop();
        this.lineNum = stackFrame.lineNum;
        this.indent  = stackFrame.indent;
    } else if (this.stats.choice_subscene_stack && this.stats.choice_subscene_stack.length) {
        stackFrame        = this.stats.choice_subscene_stack.pop();
        this.finished     = true;
        this.skipFooter   = true;
        var scene         = new Scene(stackFrame.name, this.stats, this.nav, {
            debugMode     : this.debugMode,
            secondaryMode : this.secondaryMode
        });
        scene.temps       = stackFrame.temps;
        scene.screenEmpty = this.screenEmpty;
        scene.prevLine    = this.prevLine;
        scene.lineNum     = stackFrame.lineNum;
        scene.indent      = stackFrame.indent;
        scene.execute();
    } else if (!this.temps.choice_substack && !this.stats.choice_subscene_stack) {
        throw new Error(this.lineMsg() + "invalid return; gosub has not yet been called");
    } else {
        throw new Error(this.lineMsg() + "invalid return; we've already returned from the last gosub");
    }
};
Scene.prototype["gotoref"]         = function scene_gotoref(expression) {
    var stack = this.tokenizeExpr(expression);
    var value = this.evaluateExpr(stack);
    this["goto"](value);
};
Scene.prototype.finish             = function finish(buttonName) {
    this.paragraph();
    this.finished = true;
    var self      = this;
    if (this.secondaryMode == "stats") {
        if (typeof window == "undefined")return;
        if (window.forcedScene == "choicescript_stats")return;
        if (window.isAndroidApp && window.statsMode.get())return;
        printButton(buttonName || "Next", main, false, function () {clearScreen(loadAndRestoreGame);});
        return;
    }
    var nextSceneName = this.nav && nav.nextSceneName(this.name);
    if (!nextSceneName) {
        if (!this.secondaryMode)this.ending();
        return;
    }
    if (this.screenEmpty) {
        this.goto_scene(nextSceneName);
        return;
    }
    if (!buttonName)buttonName = "Next Chapter";
    buttonName = this.replaceVariables(buttonName);
    printButton(buttonName, main, false, function () {
        safeCall(self, function () {
            var scene = new Scene(nextSceneName, self.stats, self.nav, {
                debugMode     : self.debugMode,
                secondaryMode : self.secondaryMode
            });
            scene.resetPage();
        });
    });
    if (this.debugMode)println(toJson(this.stats));
};
Scene.prototype.autofinish         = function autofinish(buttonName) {this.finish(buttonName);};
Scene.prototype.reset              = function reset() {
    this.nav.resetStats(this.stats);
    this.stats.scene = this;
};
Scene.prototype.goto_scene         = function gotoScene(data) {
    var args = trim(data).split(/ /);
    var sceneName, label;
    if (args.length == 1) {
        sceneName = data;
    } else {
        sceneName = args[0];
        label     = args[1];
    }
    this.finished     = true;
    this.skipFooter   = true;
    var scene         = new Scene(sceneName, this.stats, this.nav, {
        debugMode     : this.debugMode,
        secondaryMode : this.secondaryMode
    });
    scene.screenEmpty = this.screenEmpty;
    scene.prevLine    = this.prevLine;
    if (typeof label != "undefined")scene.targetLabel = {
        label      : label,
        origin     : this.name,
        originLine : this.lineNum
    };
    scene.execute();
};
Scene.prototype.redirect_scene     = function redirectScene(data) {
    if (this.secondaryMode != "stats")throw new Error(this.lineMsg() + "The *redirect_scene command can only be used from the stats screen.");
    var args = trim(data).split(/ /);
    var sceneName, label;
    if (args.length == 1) {
        sceneName = data;
    } else {
        sceneName = args[0];
        label     = args[1];
    }
    this.finished   = true;
    this.skipFooter = true;
    var self        = this;
    redirectFromStats(sceneName, label, this.lineNum, function () {
        delete self.secondaryMode;
        self.goto_scene(data);
    });
};
Scene.prototype.restore_purchases  = function scene_restorePurchases(data) {
    var self   = this;
    var target = this.target;
    if (!target)target = document.getElementById('text');
    var button    = printButton("Restore Purchases", target, false, function () {
        safeCall(self, function () {
            restorePurchases(function () {
                self["goto"](data);
                self.finished = false;
                self.resetPage();
            });
        });
    });
    setClass(button, "");
    this.prevLine = "block";
};
Scene.prototype.check_purchase     = function scene_checkPurchase(data) {
    this.finished   = true;
    this.skipFooter = true;
    var self        = this;
    checkPurchase(data, function (ok, result) {
        self.finished   = false;
        self.skipFooter = false;
        if (!ok) {
            result                           = { billingSupported : true };
            self.temps.choice_purchase_error = true;
        }
        result         = result || {};
        var products   = data.split(/ /);
        var everything = true;
        for (var i = 0; i < products.length; i++) {
            var purchasedProduct                          = result[products[i]] || false;
            self.temps["choice_purchased_" + products[i]] = purchasedProduct;
            if (!purchasedProduct)everything = false;
        }
        self.temps.choice_purchased_everything = everything;
        self.temps.choice_purchase_supported   = !!result.billingSupported;
        self.execute();
    });
};
Scene.prototype.purchase           = function purchase_button(data) {
    var result = /^(\w+)\s+(\S+)\s+(.*)/.exec(data);
    if (!result)throw new Error(this.lineMsg() + "invalid line; can't parse purchaseable product: " + data);
    var product     = result[1];
    var priceGuess  = trim(result[2]);
    var label       = trim(result[3]);
    this.finished   = true;
    this.skipFooter = true;
    var self        = this;
    getPrice(product, function (price) {
        if (!price || "free" == price) {
            self["goto"](label);
            self.finished = false;
            self.resetPage();
        } else {
            if (price == "guess")price = priceGuess;
            var target = self.target;
            if (!target)target = document.getElementById('text');
            self.paragraph();
            var button         = printButton("Buy It Now for " + price, target, false, function () {
                safeCall(self, function () {
                    purchase(product, function () {
                        safeCall(self, function () {
                            self["goto"](label);
                            self.finished = false;
                            self.resetPage();
                        });
                    });
                });
            });
            self.prevLine      = "block";
            if (isRestorePurchasesSupported()) {
                self.prevLine = "text";
                printLink(target, "#", "Restore Purchases", function () {
                    safeCall(self, function () {
                        restorePurchases(function (error) {
                            checkPurchase([product], function (ok, purchases) {
                                if (ok && purchases[product]) {
                                    self["goto"](label);
                                    self.finished = false;
                                    self.resetPage();
                                } else {
                                    if (error || !ok) {
                                        asyncAlert("Restore failed. Please try again.");
                                    } else {
                                        asyncAlert("Restore completed. This product is not yet purchased.");
                                    }
                                    if (ok) {
                                        if (!self.secondaryMode)clearScreen(loadAndRestoreGame);
                                    }
                                }
                            });
                        });
                    });
                });
            }
            self.skipFooter = false;
            self.finished   = false;
            self.execute();
        }
    });
};
Scene.prototype.abort              = function () {
    this.paragraph();
    this.finished = true;
};
Scene.prototype.create             = function create(line) {
    var result = /^(\w*)(.*)/.exec(line);
    if (!result)throw new Error(this.lineMsg() + "Invalid create instruction, no variable specified: " + line);
    var variable = result[1];
    this.validateVariable(variable);
    variable     = variable.toLowerCase();
    var expr     = result[2];
    var stack    = this.tokenizeExpr(expr);
    if (stack.length === 0)throw new Error(this.lineMsg() + "Invalid create instruction, no value specified: " + line);
    var self = this;

    function complexError() {throw new Error(self.lineMsg() + "Invalid create instruction, value must be a a number, true/false, or a quoted string: " + line);}

    if (stack.length > 1)complexError();
    var token = stack[0];
    if (!/STRING|NUMBER|VAR/.test(token.name))complexError();
    if ("VAR" == token.name && !/^true|false$/i.test(token.value))complexError();
    if ("STRING" == token.name && /\$!?!?{/.test(token.value))throw new Error(this.lineMsg() + "Invalid create instruction, value must be a simple string without ${}: " + line);
    var value            = this.evaluateExpr(stack);
    this.stats[variable] = value;
    if (this.nav)this.nav.startingStats[variable] = value;
};
Scene.prototype.temp               = function temp(line) {
    var result = /^(\w*)(.*)/.exec(line);
    if (!result)throw new Error(this.lineMsg() + "Invalid temp instruction, no variable specified: " + line);
    var variable = result[1];
    this.validateVariable(variable);
    var expr     = result[2];
    var stack    = this.tokenizeExpr(expr);
    if (stack.length === 0) {
        this.temps[variable.toLowerCase()] = null;
        return;
    }
    var value                          = this.evaluateExpr(stack);
    this.temps[variable.toLowerCase()] = value;
};
Scene.prototype.getVar             = function getVar(variable) {
    var value;
    variable = String(variable).toLowerCase();
    if (variable == "true")return true;
    if (variable == "false")return false;
    if (variable == "choice_subscribe_allowed")return true;
    if (variable == "choice_register_allowed")return isRegisterAllowed();
    if (variable == "choice_registered")return typeof window != "undefined" && !!window.registered;
    if (variable == "choice_is_web")return typeof window != "undefined" && !!window.isWeb;
    if (variable == "choice_is_advertising_supported")return typeof isAdvertisingSupported != "undefined" && !!isAdvertisingSupported();
    if (variable == "choice_is_trial")return !!(typeof isTrial != "undefined" && isTrial);
    if (variable == "choice_kindle")return false;
    if (variable == "choice_randomtest")return !!this.randomtest;
    if (variable == "choice_restore_purchases_allowed")return isRestorePurchasesSupported();
    if (variable == "choice_save_allowed")return areSaveSlotsSupported();
    if (variable == "choice_time_stamp")return Math.floor(new Date() / 1000);
    if ("undefined" === typeof this.temps[variable]) {
        if ("undefined" === typeof this.stats[variable]) {
            throw new Error(this.lineMsg() + "Non-existent variable '" + variable + "'");
        }
        value = this.stats[variable];
        if (value === null || value === undefined) {
            throw new Error(this.lineMsg() + "Variable '" + variable + "' exists but has no value");
        }
        if (this.debugMode)println("stats[" + variable + "]==" + value);
        return value;
    }
    value = this.temps[variable];
    if (value === null || value === undefined) {
        throw new Error(this.lineMsg() + "Variable '" + variable + "' exists but has no value");
    }
    if (this.debugMode)println("temps[" + variable + "]==" + value);
    return value;
};
Scene.prototype.setVar             = function setVar(variable, value) {
    variable = variable.toLowerCase();
    if (this.debugMode)println(variable + "=" + value);
    if ("undefined" === typeof this.temps[variable]) {
        if ("undefined" === typeof this.stats[variable]) {
            throw new Error(this.lineMsg() + "Non-existent variable '" + variable + "'");
        }
        this.stats[variable] = value;
        if (this.saveSlot == "temp")tempStatWrites[variable] = value;
    } else {
        this.temps[variable] = value;
    }
};
Scene.prototype["delete"]          = function scene_delete(variable) {
    variable = variable.toLowerCase();
    if ("undefined" === typeof this.temps[variable]) {
        if ("undefined" === typeof this.stats[variable]) {
            throw new Error(this.lineMsg() + "Non-existent variable '" + variable + "'");
        }
        delete this.stats[variable];
    } else {
        delete this.temps[variable];
    }
};
Scene.prototype.parseOptions       = function parseOptions(startIndent, choicesRemaining, expectedSubOptions) {
    var nextIndent    = null;
    var options       = [];
    var line;
    var currentChoice = choicesRemaining[0];
    if (!currentChoice)currentChoice = "choice";
    var suboptionsEncountered      = false;
    var bodyExpected               = false;
    var previousSubOptions;
    var namesEncountered           = {};
    var atLeastOneSelectableOption = false;
    var prevOption, ifResult;
    var startingLine               = this.lineNum;

    function removeModifierCommand() {
        line   = trim(line.replace(/^\s*\*(\w+)(.*)/, "$2"));
        parsed = /^\s*\*(\w+)(.*)/.exec(line);
        if (parsed) {
            command = parsed[1].toLowerCase();
            data    = trim(parsed[2]);
        } else {
            command = "";
        }
    }

    while (isDefined(line = this.lines[++this.lineNum])) {
        if (!trim(line)) {
            this.rollbackLineCoverage();
            continue;
        }
        var indent = this.getIndent(line);
        if (nextIndent === null || nextIndent === undefined) {
            if (indent <= startIndent) {
                throw new Error(this.lineMsg() + "invalid indent, expected at least one '" + currentChoice + "'");
            }
            this.indent = nextIndent = indent;
        }
        if (indent <= startIndent) {
            if (choicesRemaining.length > 1 && !suboptionsEncountered) {
                throw new Error(this.lineMsg() + "invalid indent, there were subchoices remaining: [" + choicesRemaining.join(",") + "]");
            }
            if (bodyExpected && !this.fakeChoice) {
                throw new Error(this.lineMsg() + "Expected choice body");
            }
            if (!atLeastOneSelectableOption)this.conflictingOptions("line " + (startingLine + 1) + ": No selectable options");
            if (expectedSubOptions) {
                this.verifyOptionsMatch(expectedSubOptions, options);
            }
            this.rollbackLineCoverage();
            prevOption = options[options.length - 1];
            if (!prevOption.endLine)prevOption.endLine = this.lineNum;
            this.lineNum--;
            this.rollbackLineCoverage();
            return options;
        }
        if (indent < this.indent) {
            if (false) {
                throw new Error(this.lineMsg() + "invalid indent, expected " + this.indent + ", was " + indent);
            }
            this.dedent(indent);
            this.indent = indent;
        }
        if (indent > this.indent) {
            if (choicesRemaining.length > 1)throw new Error(this.lineMsg() + "invalid indent, there were subchoices remaining: [" + choicesRemaining.join(",") + "]");
            this.rollbackLineCoverage();
            bodyExpected = false;
            continue;
        }
        if (options.length) {
            prevOption = options[options.length - 1];
            if (!prevOption.endLine)prevOption.endLine = this.lineNum;
        }
        var parsed                      = /^\s*\*(\w+)(.*)/.exec(line);
        var unselectable                = false;
        var inlineIf                    = null;
        var selectableIf                = null;
        var self                        = this;
        var overrideDefaultReuseSetting = false;
        var reuse                       = this.temps.choice_reuse;
        if (parsed) {
            var command = parsed[1].toLowerCase();
            var data    = trim(parsed[2]);
            if ("hide_reuse" == command) {
                reuse                       = "hide";
                overrideDefaultReuseSetting = true;
                removeModifierCommand();
            }
            if ("disable_reuse" == command) {
                reuse                       = "disable";
                overrideDefaultReuseSetting = true;
                removeModifierCommand();
            }
            if ("allow_reuse" == command) {
                reuse                       = "allow";
                overrideDefaultReuseSetting = true;
                removeModifierCommand();
            }
            if ("print" == command) {
                line = this.evaluateExpr(this.tokenizeExpr(data));
            } else if ("if" == command) {
                ifResult = this.parseOptionIf(data, command);
                if (ifResult) {
                    inlineIf = ifResult.condition;
                    if (ifResult.result) {
                        line = ifResult.line;
                    } else {
                        continue;
                    }
                } else {
                    this["if"](data, true);
                    continue;
                }
            } else if (/^(else|elseif|elsif)$/.test(command)) {
                this[command](data, true);
                continue;
            } else if ("selectable_if" == command) {
                ifResult = this.parseOptionIf(data, command);
                if (!ifResult)throw new Error(this.lineMsg() + "Couldn't parse the line after *selectable_if: " + data);
                line         = ifResult.line;
                selectableIf = ifResult.condition;
                unselectable = unselectable || !ifResult.result;
            } else if ("comment" == command) {
                continue;
            } else if (!command) {
            } else {
                if (Scene.validCommands[command]) {
                    throw new Error(this.lineMsg() + "Invalid indent? Expected an #option here, not *" + command);
                } else {
                    throw new Error(this.lineMsg() + "Non-existent command '" + command + "'");
                }
            }
        }
        if ("allow" != reuse) {
            if (!this.temps.choice_used)this.temps.choice_used = {};
            if (this.temps.choice_used[this.lineNum]) {
                if ("hide" == reuse)continue;
                unselectable = true;
            }
        }
        if (!/^\s*\#\s*\S/.test(line)) {
            throw new Error(this.lineMsg() + "Expected option starting with #");
        }
        this.replaceVariables(line);
        line                            = trim(trim(line).substring(1));
        var option                      = { name : line, group : currentChoice };
        if (reuse != "allow")option.reuse = reuse;
        if (this.displayOptionConditions) {
            option.displayIf = [];
            for (var i = 0; i < this.displayOptionConditions.length; i++) {
                option.displayIf[i] = this.displayOptionConditions[i];
            }
            if (inlineIf)option.displayIf.push(inlineIf);
        } else if (inlineIf) {
            option.displayIf = [inlineIf];
        }
        if (selectableIf) {
            option.selectableIf = selectableIf;
        }
        option.line = this.lineNum + 1;
        if (unselectable) {
            option.unselectable = true;
        }
        if (namesEncountered[line]) {
            this.conflictingOptions(this.lineMsg() + "Invalid option; conflicts with option '" + option.name + "' on line " + namesEncountered[line]);
        } else {
            namesEncountered[line] = option.line;
        }
        options.push(option);
        if (choicesRemaining.length > 1) {
            option.suboptions = this.parseOptions(this.indent, choicesRemaining.slice(1), previousSubOptions);
            this.indent       = nextIndent;
            if (!previousSubOptions)previousSubOptions = option.suboptions;
            suboptionsEncountered = true;
        } else {
            bodyExpected = true;
        }
        if (!unselectable)atLeastOneSelectableOption = true;
    }
    if (bodyExpected && !this.fakeChoice) {
        throw new Error(this.lineMsg() + "Expected choice body");
    }
    prevOption = options[options.length - 1];
    if (!prevOption.endLine)prevOption.endLine = this.lineNum;
    if (!atLeastOneSelectableOption)this.conflictingOptions("line " + (startingLine + 1) + ": No selectable options");
    return options;
};
Scene.prototype.parseOptionIf      = function parseOptionIf(data) {
    var parsed = /^\s*\((.*)\)\s+(#.*)/.exec(data);
    if (!parsed) {
        return;
    }
    var condition = parsed[1];
    var stack     = this.tokenizeExpr(condition);
    var result    = this.evaluateExpr(stack);
    if (this.debugMode)println(condition + " :: " + result);
    result = bool(result, this.lineNum + 1);
    result = result || this.testPath;
    return { result : result, line : parsed[2], condition : null };
};
Scene.prototype.conflictingOptions = function conflictingOptions(str) {throw new Error(str);};
Scene.prototype.verifyOptionsMatch = function verifyOptionsMatch(prev, current) {
    function findMatch(name, options) {
        for (var i = 0; i < options.length; i++) {
            var option = options[i];
            if (option && name == option.name) {
                return option;
            }
        }
        return null;
    }

    var prevOpt, curOpt;
    for (var i = 0; i < prev.length; i++) {
        prevOpt = prev[i];
        curOpt  = findMatch(prevOpt.name, current);
        if (!curOpt)throw new Error(this.lineMsg() + "Missing expected suboption '" + prevOpt.name + "'; all suboptions must have same option list");
    }
    if (prev.length == current.length)return;
    for (i = 0; i < current.length; i++) {
        curOpt  = current[i];
        prevOpt = findMatch(curOpt.name, prev);
        if (!prevOpt)throw new Error(this.lineMsg() + "Added unexpected suboption '" + curOpt.name + "'; all suboptions must have same option list");
    }
    throw new Error(this.lineMsg() + "Bug? previous options and current options mismatch, but no particular missing element");
};
Scene.prototype.renderOptions      = function renderOptions(groups, options, callback) {
    for (var i = 0; i < options.length; i++) {
        var option  = options[i];
        option.name = this.replaceVariables(option.name);
    }
    this.paragraph();
    printOptions(groups, options, callback);
    if (this.debugMode)println(toJson(this.stats));
    if (this.finished)printFooter();
};
Scene.prototype.page_break         = function page_break(buttonName) {
    if (this.screenEmpty)return;
    if (!buttonName)buttonName = "Next";
    buttonName    = this.replaceVariables(buttonName);
    this.paragraph();
    this.finished = true;
    var self      = this;
    printButton(buttonName, main, false, function () {
        self.finished = false;
        self.resetPage();
    });
    if (this.debugMode)println(toJson(this.stats));
};
Scene.prototype.line_break         = function line_break() {println("", this.target);};
Scene.prototype.image              = function image(data) {
    data     = data || "";
    var args = data.split(" ");
    if (args > 2)throw new Error(this.lineMsg() + "Too many words; expected filename and alignment: " + data);
    var source    = args[0];
    var alignment = args[1];
    alignment     = alignment || "center";
    if (!/(right|left|center|none)/.test(alignment))throw new Error(this.lineMsg() + "Invalid alignment, expected right, left, center, or none: " + data);
    printImage(source, alignment);
    if (this.verifyImage)this.verifyImage(source);
};
Scene.prototype.sound              = function sound(source) {
    if (typeof playSound == "function")playSound(source);
    if (this.verifyImage)this.verifyImage(source);
};
Scene.prototype.kindle_image       = function kindle_image() {};
Scene.prototype.kindle_search      = Scene.prototype.kindle_product = function kindle_search(data) {
    var result = /^\((.+)\) ([^\)]+)/.exec(data);
    if (!result)throw new Error(this.lineMsg() + "Invalid arguments: " + data);
    var query      = result[1];
    var buttonName = result[2];
    if ("undefined" != typeof kindleButton)kindleButton(this.target, query, buttonName);
};
Scene.prototype.link                = function link(data) {
    var result = /^(\S+)\s*(.*)/.exec(data);
    if (!result)throw new Error(this.lineMsg() + "invalid line; this line should have an URL: " + data);
    var href         = result[1];
    var anchorText   = trim(result[2]) || href;
    printLink(this.target, href, anchorText);
    this.prevLine    = "text";
    this.screenEmpty = false;
};
Scene.prototype.link_button         = function linkButton(data) {
    if (typeof window == "undefined")return;
    var result = /^(\S+)\s*(.*)/.exec(data);
    if (!result)throw new Error(this.lineMsg() + "invalid line; this line should have an URL: " + data);
    var href       = result[1];
    var anchorText = trim(result[2]) || href;
    var target     = this.target;
    if (!target)target = document.getElementById('text');
    printButton(anchorText, target, false, function () {window.location.href = href;});
    this.prevLine      = "empty";
    this.screenEmpty   = false;
};
Scene.prototype.getIndent           = function getIndent(line) {
    if (line === null || line === undefined)return 0;
    var spaces = line.match(/^([ \t]*)/);
    if (spaces === null || spaces === undefined)return 0;
    var whitespace = spaces[0];
    var len        = whitespace.length;
    if (0 === len)return 0;
    var tab   = /\t/.test(whitespace);
    var space = / /.test(whitespace);
    if (tab && space) {
        throw new Error(this.lineMsg() + "Tabs and spaces appear on the same line");
    }
    if (tab) {
        this.firstTab = this.lineNum + 1;
        if (this.firstSpace) {
            throw new Error(this.lineMsg() + "Illegal mixing of spaces and tabs; this line has a tab, but there were spaces on line " + this.firstSpace);
        }
    } else {
        this.firstSpace = this.lineNum + 1;
        if (this.firstTab) {
            throw new Error(this.lineMsg() + "Illegal mixing of spaces and tabs; this line has a space, but there were tabs on line " + this.firstTab);
        }
    }
    return len;
};
Scene.prototype.comment             = function comment(line) {if (this.debugMode)println("*comment " + line);};
Scene.prototype.advertisement       = function advertisement() {
    if (typeof isFullScreenAdvertisingSupported != "undefined" && isFullScreenAdvertisingSupported()) {
        this.finished   = true;
        this.skipFooter = true;
        var self        = this;
        showFullScreenAdvertisement(function () {
            self.finished   = false;
            self.skipFooter = false;
            self.resetPage();
        });
    }
};
Scene.prototype.looplimit           = function looplimit() {};
Scene.prototype.hide_reuse          = function hide_reuse() {this.temps.choice_reuse = "hide";};
Scene.prototype.disable_reuse       = function disable_reuse() {this.temps.choice_reuse = "disable";};
Scene.prototype.allow_reuse         = function allow_reuse() {this.temps.choice_reuse = "allow";};
Scene.prototype.label               = function label() {};
Scene.prototype.print               = function scene_print(expr) {
    var value        = this.evaluateExpr(this.tokenizeExpr(expr));
    this.prevLine    = "text";
    this.screenEmpty = false;
    this.printLine(value);
    printx(' ', this.target);
};
Scene.prototype.input_text          = function input_text(variable) {
    var inputType = "text";
    var longMatch = /^\S+(\s+long)/.exec(variable);
    if (longMatch) {
        variable  = variable.substring(0, variable.length - longMatch[1].length);
        inputType = "textarea";
    }
    this.validateVariable(variable);
    this.finished = true;
    this.paragraph();
    var self      = this;
    printInput(this.target, inputType, function (value) {
        safeCall(self, function () {
            value = "" + value || "";
            value = value.replace(/\n/g, "[n/]");
            if (self.nav)self.nav.bugLog.push("*input_text " + variable + " " + value);
            self.finished = false;
            self.save(function () {
                self.setVar(variable, value);
                self.resetPage();
            }, "");
        });
    });
    if (this.debugMode)println(toJson(this.stats));
};
Scene.prototype.input_number        = function input_number(data) {
    var args = data.split(/ /);
    if (args.length != 3) {
        throw new Error(this.lineMsg() + "Invalid input_number statement, expected three args: varname min max");
    }
    var variable, minimum, maximum;
    variable = args[0];
    this.validateVariable(variable);
    minimum  = this.evaluateValueExpr(args[1]);
    if (isNaN(minimum * 1))throw new Error(this.lineMsg() + "Invalid minimum, not numeric: " + minimum);
    maximum = this.evaluateValueExpr(args[2]);
    if (isNaN(maximum * 1))throw new Error(this.lineMsg() + "Invalid maximum, not numeric: " + maximum);
    if (parseFloat(minimum) > parseFloat(maximum))throw new Error(this.lineMsg() + "Minimum " + minimum + " should not be greater than maximum " + maximum);
    function isInt(x) {
        var y = parseInt(x, 10);
        if (isNaN(y))return false;
        return x == y && x.toString() == y.toString();
    }

    var intRequired;
    if (isInt(minimum) && isInt(maximum)) {
        intRequired = 1;
    }
    this.finished = true;
    this.paragraph();
    var self      = this;
    printInput(this.target, "number", function (value) {
        safeCall(self, function () {
            var numValue = parseFloat("" + value);
            if (isNaN(numValue)) {
                asyncAlert("Please type in a number.");
                return;
            }
            if (intRequired && !isInt(value)) {
                asyncAlert("Please type in an integer number.");
                return;
            }
            if (numValue < minimum * 1) {
                asyncAlert("Please use a number greater than or equal to " + minimum);
                return;
            }
            if (numValue > maximum * 1) {
                asyncAlert("Please use a number less than or equal to " + maximum);
                return;
            }
            if (self.nav)self.nav.bugLog.push("*input_number " + variable + " " + value);
            self.finished = false;
            self.save(function () {
                self.setVar(variable, numValue);
                self.resetPage();
            }, "");
        });
    }, minimum, maximum, intRequired);
    if (this.debugMode)println(toJson(this.stats));
};
Scene.prototype.script              = function script(code) {
    var stats = this.stats;
    var temps = this.temps;
    try {
        if (typeof window == "undefined") {
            (function () {
                var window = _global;
                eval(code);
            }).call(this);
        } else {
            eval(code);
        }
    } catch (e) {
        throw new Error(this.lineMsg() + "error executing *script: " + e + (e.stack ? "\n" + e.stack : ""));
    }
};
Scene.prototype.validateVariable    = function validateVariable(variable) {
    if (!variable || !/^[a-zA-Z]/.test(variable)) {
        throw new Error(this.lineMsg() + "Invalid variable name, must start with a letter: " + variable);
    }
    if (!/^\w+$/.test(variable)) {
        throw new Error(this.lineMsg() + "Invalid variable name: '" + variable + "'");
    }
    if (/^(and|or|true|false)$/.test(variable))throw new Error(this.lineMsg() + "Invalid variable name, '" + variable + "' is a reserved word");
    if (/^choice_/.test(variable))throw new Error(this.lineMsg() + "Invalid variable name, variables may not start with 'choice_'; this is a reserved prefix");
};
Scene.prototype.rand                = function rand(data) {
    var args = data.split(/ /);
    if (args.length != 3) {
        throw new Error(this.lineMsg() + "Invalid rand statement, expected three args: varname min max");
    }
    var variable, minimum, maximum, diff;
    variable = args[0];
    this.validateVariable(variable);
    minimum  = this.evaluateValueExpr(args[1]);
    maximum  = this.evaluateValueExpr(args[2]);
    diff     = maximum - minimum;
    if (isNaN(diff)) {
        throw new Error(this.lineMsg() + "Invalid rand statement, min and max must be numbers");
    }
    if (diff < 0) {
        throw new Error(this.lineMsg() + "Invalid rand statement, min must be less than max: " + minimum + " > " + maximum);
    }
    if (diff === 0) {
        this.setVar(variable, minimum);
        return;
    }
    function isInt(x) {
        var y = parseInt(x, 10);
        if (isNaN(y))return false;
        return x == y && x.toString() == y.toString();
    }

    var result;
    var random = Math.random();
    if (isInt(minimum) && isInt(maximum)) {
        result = 1 * minimum + Math.floor(random * (diff + 1));
    } else {
        result = 1 * minimum + random * diff;
    }
    this.setVar(variable, result);
    if (this.randomLog) {
        this.randomLog("*rand " + variable + " " + result);
    }
    if (this.nav)this.nav.bugLog.push("*rand " + variable + " " + result);
};
Scene.prototype.set                 = function set(line) {
    var result = /^(\w*)(.*)/.exec(line);
    if (!result)throw new Error(this.lineMsg() + "Invalid set instruction, no variable specified: " + line);
    var variable = result[1];
    this.validateVariable(variable);
    var expr     = result[2];
    var stack    = this.tokenizeExpr(expr);
    if (stack.length === 0)throw new Error(this.lineMsg() + "Invalid set instruction, no expression specified: " + line);
    if (/OPERATOR|FAIRMATH/.test(stack[0].name))stack.unshift({ name : "VAR", value : variable, pos : "(implicit)" });
    var value = this.evaluateExpr(stack);
    this.setVar(variable, value);
};
Scene.prototype.setref              = function setref(line) {
    var stack     = this.tokenizeExpr(line);
    var reference = this.evaluateValueToken(stack.shift(), stack);
    var referenceExpressionString;
    try {
        referenceExpressionString = trim(line.substring(0, stack[0].pos - stack[0].value.length));
    } catch (e) {
    }
    try {
        this.validateVariable(reference);
    } catch (e) {
        if (typeof referenceExpressionString !== undefined) {
            throw new Error(this.lineMsg() + "The expression (" + referenceExpressionString + ") was \"" + reference + "\", which is invalid:\n" + e.message);
        }
    }
    if (/OPERATOR|FAIRMATH/.test(stack[0].name))stack.unshift({ name : "VAR", value : reference, pos : "(implicit)" });
    var value = this.evaluateExpr(stack);
    this.setVar(reference, value);
};
Scene.prototype.share_this_game     = function share_links(now) {
    now           = !!trim(now);
    this.paragraph();
    printShareLinks(this.target, now);
    this.prevLine = "empty";
};
Scene.prototype.more_games          = function more_games(now) {
    if (typeof window == "undefined" || typeof moreGames == "undefined")return;
    if (!!trim(now)) {
        moreGames();
        return;
    }
    var self   = this;
    var target = this.target;
    if (!target)target = document.getElementById('text');
    var button    = printButton("Play More Games Like This", target, false, function () {safeCall(self, moreGames);});
    setClass(button, "");
    this.prevLine = "block";
};
Scene.prototype.ending              = function ending() {
    if (typeof window == "undefined")return;
    this.paragraph();
    var groups    = [""];
    options       = [];
    options.push({ name : "Play again.", group : "choice", restart : true });
    options.push({ name : "Play more games like this.", group : "choice", moreGames : true });
    options.push({ name : "Share this game with friends.", group : "choice", share : true });
    options.push({ name : "Email me when new games are available.", group : "choice", subscribe : true });
    var self      = this;

    function endingMenu() {
        printFollowButtons();
        self.renderOptions([""], options, function (option) {
            if (option.restart) {
                self.restart();
                return;
            } else if (option.moreGames) {
                self.more_games("now");
                if (typeof curl != "undefined")curl();
            } else if (option.share) {
                clearScreen(function () {
                    self.share_this_game("now");
                    endingMenu();
                });
            } else if (option.subscribe) {
                subscribeLink();
            }
        });
    }

    endingMenu();
    this.finished = true;
};
Scene.prototype.restart             = function restart() {
    if (this.secondaryMode)throw new Error(this.lineMsg() + "Cannot *restart in " + this.secondaryMode + " mode");
    this.finished = true;
    delayBreakEnd();
    var self      = this;
    this.save(function () {
        self.reset();
        var startupScene = self.nav.getStartupScene();
        var scene        = new Scene(startupScene, self.stats, self.nav, {
            debugMode     : self.debugMode,
            secondaryMode : false
        });
        scene.resetPage();
    }, "");
};
Scene.prototype.subscribe           = function scene_subscribe(now) {
    now             = ("now" == now);
    this.prevLine   = "block";
    this.finished   = true;
    this.skipFooter = true;
    var self        = this;
    subscribe(this.target, now, function (now) {
        self.finished = false;
        if (now) {
            self.skipFooter = false;
            self.execute();
        } else {
            self.resetPage();
        }
    });
};
Scene.prototype.restore_game        = function restore_game() {
    this.finished          = true;
    this.skipFooter        = true;
    var self               = this;
    var unrestorableScenes = this.parseRestoreGame(false);

    function renderRestoreMenu(saveList, dirtySaveList) {
        self.paragraph();
        var options = [];
        for (var i = 0; i < saveList.length; i++) {
            var save = saveList[i];
            var date = new Date(save.timestamp * 1);
            if (!save)continue;
            var name = "";
            if (save.temps && save.temps.choice_restore_name)name = save.temps.choice_restore_name;
            options.push({ name : name + " (" + simpleDateTimeFormat(date) + ")", group : "choice", state : save });
        }
        if (false)options.push({ name : "Restore using a password.", group : "choice", password : true });
        options.push({ name : "Retrieve saved games online from choiceofgames.com.", group : "choice", fetch : true });
        if (dirtySaveList.length)options.push({
            name   : "Upload saved games to choiceofgames.com.",
            group  : "choice",
            upload : true
        });
        options.push({ name : "Cancel.", group : "choice", cancel : true });
        var groups = [""];
        self.renderOptions(groups, options, function (option) {
            if (option.upload) {
                clearScreen(function () {
                    fetchEmail(function (defaultEmail) {
                        self.printLine("Please type your email address to identify yourself.");
                        promptEmailAddress(this.target, defaultEmail, function (cancel, email) {
                            if (cancel) {
                                self.finished = false;
                                self.resetPage();
                                return;
                            }
                            clearScreen(function () {
                                startLoading();
                                submitDirtySaves(dirtySaveList, email, function (ok) {
                                    doneLoading();
                                    self.prevLine = "text";
                                    if (!ok) {
                                        self.printLine("Error uploading saves. Please try again later.");
                                        renderRestoreMenu(saveList, dirtySaveList);
                                    } else {
                                        var count = dirtySaveList.length + (dirtySaveList.length == 1 ? " save" : " saves");
                                        self.printLine("Uploaded " + count + ".");
                                        renderRestoreMenu(saveList, []);
                                    }
                                });
                            });
                        });
                    });
                });
            } else if (option.fetch) {
                clearScreen(function () {
                    fetchEmail(function (defaultEmail) {
                        self.printLine("Please type your email address to identify yourself.");
                        promptEmailAddress(this.target, defaultEmail, function (cancel, email) {
                            if (cancel) {
                                self.finished = false;
                                self.resetPage();
                                return;
                            }
                            clearScreen(function () {
                                startLoading();
                                getRemoteSaves(email, function (remoteSaveList) {
                                    doneLoading();
                                    self.prevLine = "text";
                                    if (!remoteSaveList) {
                                        self.printLine("Error downloading saves. Please try again later.");
                                        renderRestoreMenu(saveList, dirtySaveList);
                                    } else {
                                        mergeRemoteSaves(remoteSaveList, "recordDirty", function (saveList, newRemoteSaves, dirtySaveList) {
                                            if (!remoteSaveList.length) {
                                                self.printLine("No saves downloaded for email address \"" + email + "\". (Is that the correct email address?) If you're having trouble, please contact support at " + getSupportEmail() + ".");
                                                renderRestoreMenu(saveList, dirtySaveList);
                                            } else {
                                                var downloadCount = remoteSaveList.length + " saved " + (remoteSaveList.length == 1 ? "game" : "games");
                                                var newCount      = newRemoteSaves + " new saved " + (newRemoteSaves == 1 ? "game" : "games");
                                                self.printLine("Synchronized " + downloadCount + ". Downloaded " + newCount + ".");
                                                renderRestoreMenu(saveList, dirtySaveList);
                                            }
                                        });
                                    }
                                });
                            });
                        });
                    });
                });
            } else if (option.password) {
                clearScreen(function () {self.restore_password();});
            } else {
                if (option.cancel) {
                    self.finished = false;
                    self.resetPage();
                } else {
                    var state     = option.state;
                    var sceneName = null;
                    if (state.stats && state.stats.sceneName)sceneName = ("" + state.stats.sceneName).toLowerCase();
                    var unrestorable = unrestorableScenes[sceneName];
                    if (unrestorable) {
                        asyncAlert(unrestorable);
                        self.finished = false;
                        self.resetPage();
                        return;
                    }
                    saveCookie(function () {clearScreen(function () {restoreGame(state, null, true);});}, "", state.stats, state.temps, state.lineNum, state.indent, this.debugMode, this.nav);
                }
            }
        });
    }

    getDirtySaveList(function (dirtySaveList) {getSaves(function (saveList) {renderRestoreMenu(saveList, dirtySaveList);});});
};
Scene.prototype.restore_password    = function restore_password() {
    var alreadyFinished    = this.finished;
    this.finished          = true;
    this.paragraph();
    this.printLine('Please paste your password here, then press "Next" below to continue.');
    this.prevLine          = "text";
    this.paragraph();
    var self               = this;
    var unrestorableScenes = this.parseRestoreGame(alreadyFinished);
    getPassword(this.target, function (cancel, password) {
        if (cancel) {
            self.finished = false;
            self.resetPage();
            return;
        }
        password  = password.replace(/\s/g, "");
        password  = password.replace(/^.*BEGINPASSWORD-----/, "");
        var token = self.deobfuscatePassword(password);
        token     = token.replace(/^[^\{]*/, "");
        token     = token.replace(/[^\}]*$/, "");
        var state;
        try {
            state = jsonParse(token);
        } catch (e) {
            asyncAlert("Sorry, that password was invalid. Please contact " + getSupportEmail() + " for assistance. Be sure to include your password in the email.");
            return;
        }
        var sceneName = null;
        if (state.stats && state.stats.sceneName)sceneName = ("" + state.stats.sceneName).toLowerCase();
        var unrestorable = unrestorableScenes[sceneName];
        if (unrestorable) {
            asyncAlert(unrestorable);
            self.finished = false;
            self.resetPage();
            return;
        }
        saveCookie(function () {clearScreen(function () {restoreGame(state, null, false);});}, "", state.stats, state.temps, state.lineNum, state.indent, this.debugMode, this.nav);
    });
    if (alreadyFinished)printFooter();
};
Scene.prototype.parseRestoreGame    = function parseRestoreGame(alreadyFinished) {
    if (alreadyFinished) {
        this.lineNum--;
        this.rollbackLineCoverage();
    }
    var nextIndent         = null;
    var unrestorableScenes = {};
    var line;
    var startIndent        = this.indent;
    while (isDefined(line = this.lines[++this.lineNum])) {
        if (!trim(line)) {
            this.rollbackLineCoverage();
            continue;
        }
        var indent = this.getIndent(line);
        if (nextIndent === null || nextIndent === undefined) {
            if (indent > startIndent) {
                this.indent = nextIndent = indent;
            }
        }
        if (indent <= startIndent) {
            if (!alreadyFinished) {
                this.lineNum--;
                this.rollbackLineCoverage();
            }
            return unrestorableScenes;
        }
        if (indent != this.indent) {
            throw new Error(this.lineMsg() + "invalid indent, expected " + this.indent + ", was " + indent);
        }
        line       = trim(line);
        var result = /^(\w+)\s+(.*)/.exec(line);
        if (!result)throw new Error(this.lineMsg() + "invalid line; this line should have a scene name followed by an error message: " + line);
        var sceneName                 = result[1].toLowerCase();
        var error                     = trim(result[2]);
        unrestorableScenes[sceneName] = error;
    }
    if (!alreadyFinished) {
        this.lineNum--;
        this.rollbackLineCoverage();
    }
    return unrestorableScenes;
};
Scene.prototype.check_registration  = function scene_checkRegistration() {
    if (typeof window == "undefined" || typeof isRegistered == "undefined")return;
    this.finished   = true;
    this.skipFooter = true;
    var self        = this;
    isRegistered(function () {
        self.finished   = false;
        self.skipFooter = false;
        self.execute();
    });
};
Scene.prototype.login               = function scene_login(optional) {
    if (typeof window == "undefined" || typeof loginForm == "undefined")return;
    optional = trim(optional);
    if (optional) {
        if (optional != "optional")throw new Error(this.lineMsg() + "invalid *login option: " + optional);
        optional = 1;
    }
    var self        = this;
    this.finished   = true;
    this.skipFooter = true;
    this.paragraph();
    var target      = this.target;
    if (!target)target = document.getElementById('text');
    loginForm(target, optional, null, function () {
        clearScreen(function () {
            self.finished    = false;
            self.prevLine    = "empty";
            self.screenEmpty = true;
            self.execute();
        });
    });
};
Scene.prototype.save_game           = function save_game(destinationSceneName) {
    if (!destinationSceneName)throw new Error(this.lineMsg() + "*save_game requires a destination file name, e.g. *save_game Episode2");
    if (this.temps.choice_user_restored)return;
    var self        = this;
    this.finished   = true;
    this.skipFooter = true;
    fetchEmail(function (defaultEmail) {
        self.paragraph();
        var form                 = document.createElement("form");
        setClass(form, "saveGame");
        form.action              = "#";
        var message              = document.createElement("div");
        message.style.color      = "red";
        message.style.fontWeight = "bold";
        form.appendChild(message);
        var saveName             = document.createElement("input");
        saveName.type            = "text";
        saveName.name            = "saveName";
        saveName.setAttribute("placeholder", "Type a name for your saved game");
        saveName.setAttribute("style", "font-size: 25px; width: 90%;");
        form.appendChild(saveName);
        if (_global.automaticCloudStorage) {
            println("", form);
        } else {
            println("", form);
            println("", form);
            println("Please login to the choiceofgames.com save system with your email address below.", form);
            var emailInput = document.createElement("input");
            try {
                emailInput.type = "email";
            } catch (e) {
            }
            emailInput.name    = "email";
            emailInput.value   = defaultEmail;
            emailInput.setAttribute("placeholder", "you@example.com");
            emailInput.setAttribute("style", "font-size: 25px; width: 90%;");
            form.appendChild(emailInput);
            println("", form);
            println("", form);
            var subscribeLabel = document.createElement("label");
            subscribeLabel.setAttribute("for", "subscribeBox");
            var subscribeBox   = document.createElement("input");
            subscribeBox.type  = "checkbox";
            subscribeBox.name  = "subscribe";
            subscribeBox.setAttribute("id", "subscribeBox");
            subscribeBox.setAttribute("checked", true);
            subscribeLabel.appendChild(subscribeBox);
            subscribeLabel.appendChild(document.createTextNode("Email me when new games are available."));
            form.appendChild(subscribeLabel);
        }
        println("", form);
        var target               = this.target;
        if (!target)target = document.getElementById('text');
        target.appendChild(form);
        printButton("Next", form, true);
        printButton("Cancel", target, false, function () {
            clearScreen(function () {
                self.finished    = false;
                self.prevLine    = "empty";
                self.screenEmpty = true;
                self.execute();
            });
        });
        form.onsubmit      = function (e) {
            preventDefault(e);
            safeCall(this, function () {
                var messageText;
                if (!trim(saveName.value)) {
                    messageText       = document.createTextNode("Please type a name for your saved game.");
                    message.innerHTML = "";
                    message.appendChild(messageText);
                    return;
                }
                var slot      = "save" + new Date().getTime();
                var saveStats = {};
                for (var stat in self.stats) {
                    if ("scene" == stat)continue;
                    saveStats[stat] = self.stats[stat];
                }
                saveStats.scene = { name : destinationSceneName };
                if (_global.automaticCloudStorage) {
                    clearScreen(function () {
                        saveCookie(function () {
                            recordSave(slot, function () {
                                self.finished    = false;
                                self.prevLine    = "empty";
                                self.screenEmpty = true;
                                self.execute();
                            });
                        }, slot, saveStats, {
                            choice_reuse         : "allow",
                            choice_user_restored : true,
                            choice_restore_name  : saveName.value
                        }, 0, 0, false, self.nav);
                    });
                    return;
                }
                var shouldSubscribe = subscribeBox.checked;
                var email           = trim(emailInput.value);
                if (!/^\S+@\S+\.\S+$/.test(email)) {
                    messageText       = document.createTextNode("Sorry, \"" + email + "\" is not an email address.  Please type your email address again.");
                    message.innerHTML = "";
                    message.appendChild(messageText);
                    return;
                }
                recordEmail(email, function () {
                    clearScreen(function () {
                        saveCookie(function () {
                            recordSave(slot, function () {
                                startLoading();
                                submitRemoteSave(slot, email, shouldSubscribe, function (ok) {
                                    doneLoading();
                                    if (!ok) {
                                        asyncAlert("Couldn't upload your saved game to choiceofgames.com. You can try again later from the Restore menu.", function () {
                                            self.finished    = false;
                                            self.prevLine    = "empty";
                                            self.screenEmpty = true;
                                            self.execute();
                                        });
                                    } else {
                                        self.finished    = false;
                                        self.prevLine    = "empty";
                                        self.screenEmpty = true;
                                        self.execute();
                                    }
                                });
                            });
                        }, slot, saveStats, {
                            choice_reuse         : "allow",
                            choice_user_restored : true,
                            choice_restore_name  : saveName.value
                        }, 0, 0, false, self.nav);
                    });
                });
            });
        };
        printFooter();
    });
};
Scene.prototype.show_password       = function show_password() {
    if (this.temps.choice_user_restored)return;
    this.paragraph();
    if (typeof(window) != "undefined" && !window.isMobile) {
        this.printLine('Please copy and paste the password in a safe place, then press "Next" below to continue.');
        println("", this.target);
        println("", this.target);
    }
    var password  = computeCookie(this.stats, this.temps, this.lineNum, this.indent);
    password      = this.obfuscate(password);
    showPassword(this.target, password);
    this.prevLine = "block";
};
Scene.prototype.obfuscate           = function obfuscate(password) {
    var self = this;
    return password.replace(/./g, function (x) {
        var y = self.obfuscator[x];
        return y;
    });
};
Scene.prototype.obfuscator          = {
    " "  : "k",
    "!"  : "E",
    "\"" : "`",
    "#"  : "\\",
    "$"  : "r",
    "%"  : "J",
    "&"  : "o",
    "'"  : "0",
    "("  : "Z",
    ")"  : "M",
    "*"  : "G",
    "+"  : "t",
    ","  : "Y",
    "-"  : "f",
    "."  : "2",
    "/"  : "!",
    "0"  : "i",
    "1"  : "*",
    "2"  : "1",
    "3"  : "3",
    "4"  : "[",
    "5"  : "6",
    "6"  : "v",
    "7"  : "\"",
    "8"  : "F",
    "9"  : "9",
    ":"  : "{",
    ";"  : "Q",
    "<"  : "?",
    "="  : "5",
    ">"  : "#",
    "?"  : "K",
    "@"  : "/",
    "A"  : "=",
    "B"  : "N",
    "C"  : "z",
    "D"  : "$",
    "E"  : "W",
    "F"  : "(",
    "G"  : ")",
    "H"  : "q",
    "I"  : "C",
    "J"  : "+",
    "K"  : "U",
    "L"  : ".",
    "M"  : "H",
    "N"  : "B",
    "O"  : "S",
    "P"  : "X",
    "Q"  : "I",
    "R"  : "-",
    "S"  : "m",
    "T"  : "D",
    "U"  : "^",
    "V"  : "A",
    "W"  : "a",
    "X"  : "y",
    "Y"  : ",",
    "Z"  : "d",
    "["  : "O",
    "\\" : "s",
    "]"  : "8",
    "^"  : "sVii6h",
    "_"  : "]",
    "`"  : "sViivi",
    "a"  : "4",
    "b"  : "g",
    "c"  : "%",
    "d"  : "w",
    "e"  : "h",
    "f"  : "n",
    "g"  : "b",
    "h"  : "7",
    "i"  : "x",
    "j"  : "~",
    "k"  : "_",
    "l"  : "l",
    "m"  : ":",
    "n"  : "c",
    "o"  : "L",
    "p"  : "j",
    "q"  : "u",
    "r"  : "R",
    "s"  : "}",
    "t"  : "p",
    "u"  : "V",
    "v"  : "P",
    "w"  : "'",
    "x"  : "T",
    "y"  : "|",
    "z"  : "@",
    "{"  : "e",
    "|"  : "sVii\"%",
    "}"  : ";",
    "~"  : "sVii\"h"
};
Scene.prototype.deobfuscator        = {
    "k"  : " ",
    "E"  : "!",
    "`"  : "\"",
    "\\" : "#",
    "r"  : "$",
    "J"  : "%",
    "o"  : "&",
    "0"  : "'",
    "Z"  : "(",
    "M"  : ")",
    "G"  : "*",
    "t"  : "+",
    "Y"  : ",",
    "f"  : "-",
    "2"  : ".",
    "!"  : "/",
    "i"  : "0",
    "*"  : "1",
    "1"  : "2",
    "3"  : "3",
    "["  : "4",
    "6"  : "5",
    "v"  : "6",
    "\"" : "7",
    "F"  : "8",
    "9"  : "9",
    "{"  : ":",
    "Q"  : ";",
    "?"  : "<",
    "5"  : "=",
    "#"  : ">",
    "K"  : "?",
    "/"  : "@",
    "="  : "A",
    "N"  : "B",
    "z"  : "C",
    "$"  : "D",
    "W"  : "E",
    "("  : "F",
    ")"  : "G",
    "q"  : "H",
    "C"  : "I",
    "+"  : "J",
    "U"  : "K",
    "."  : "L",
    "H"  : "M",
    "B"  : "N",
    "S"  : "O",
    "X"  : "P",
    "I"  : "Q",
    "-"  : "R",
    "m"  : "S",
    "D"  : "T",
    "^"  : "U",
    "A"  : "V",
    "a"  : "W",
    "y"  : "X",
    ","  : "Y",
    "d"  : "Z",
    "O"  : "[",
    "s"  : "\\",
    "8"  : "]",
    "]"  : "_",
    "4"  : "a",
    "g"  : "b",
    "%"  : "c",
    "w"  : "d",
    "h"  : "e",
    "n"  : "f",
    "b"  : "g",
    "7"  : "h",
    "x"  : "i",
    "~"  : "j",
    "_"  : "k",
    "l"  : "l",
    ":"  : "m",
    "c"  : "n",
    "L"  : "o",
    "j"  : "p",
    "u"  : "q",
    "R"  : "r",
    "}"  : "s",
    "p"  : "t",
    "V"  : "u",
    "P"  : "v",
    "'"  : "w",
    "T"  : "x",
    "|"  : "y",
    "@"  : "z",
    "e"  : "{",
    ";"  : "}"
};
Scene.prototype.deobfuscatePassword = function deobfuscatePassword(password) {
    var self = this;
    password = password.replace(/./g, function (x) {
        var y = self.deobfuscator[x];
        return y;
    });
    return password;
};
Scene.prototype.stat_chart          = function stat_chart() {
    var rows   = this.parseStatChart();
    var target = this.target;
    if (!target)target = document.getElementById('text');
    if (this.prevLine == "text")println("", target);
    var barWidth         = 0;
    var standardFontSize = 0;

    function fixFontSize(span1, span2) {
        if (!standardFontSize) {
            if (window.getComputedStyle) {
                standardFontSize = parseInt(getComputedStyle(document.body).fontSize, 10);
            } else if (document.body.currentStyle) {
                standardFontSize = parseInt(document.body.currentStyle.fontSize, 10);
            } else {
                standardFontSize = 16;
            }
        }
        if (!barWidth)barWidth = span1.parentNode.offsetWidth;
        var spanMaxWidth, biggestSpanWidth;
        if (span2) {
            spanMaxWidth     = barWidth / 2 - 1;
            biggestSpanWidth = Math.max(span1.offsetWidth, span2.offsetWidth);
        } else {
            spanMaxWidth     = barWidth;
            biggestSpanWidth = span1.offsetWidth;
        }
        if (biggestSpanWidth > spanMaxWidth) {
            span1.parentNode.style.fontSize = Math.floor(standardFontSize * spanMaxWidth / biggestSpanWidth) + "px";
        }
    }

    for (i = 0; i < rows.length; i++) {
        var row        = rows[i];
        var type       = row.type;
        var variable   = row.variable;
        var value      = this.getVar(variable);
        var label      = this.replaceVariables(row.label);
        var definition = this.replaceVariables(row.definition || "");
        var statWidth, div, span, statValue;
        if (type == "text") {
            div  = document.createElement("div");
            setClass(div, "statLine");
            span = document.createElement("span");
            if (trim(label) || trim(value)) {
                printx("\u00a0\u00a0" + label + ": " + value, span);
            } else {
                printx(" ", span);
            }
            div.appendChild(span);
            target.appendChild(div);
        } else if (type == "percent") {
            div                   = document.createElement("div");
            setClass(div, "statBar statLine");
            span                  = document.createElement("span");
            printx("\u00a0\u00a0" + label + ": " + value + "%", span);
            div.appendChild(span);
            statValue             = document.createElement("div");
            setClass(statValue, "statValue");
            statValue.style.width = value + "%";
            statValue.innerHTML   = "&nbsp;";
            div.appendChild(statValue);
            target.appendChild(div);
            fixFontSize(span);
        } else if (type == "opposed_pair") {
            div                   = document.createElement("div");
            setClass(div, "statBar statLine opposed");
            span0                 = document.createElement("span");
            printx("\u00a0\u00a0" + label + ": " + value + "% ", span0);
            div.appendChild(span0);
            span                  = document.createElement("span");
            span.setAttribute("style", "float: right");
            printx(row.opposed_label + ": " + (100 - value) + "%\u00a0\u00a0", span);
            div.appendChild(span);
            statValue             = document.createElement("div");
            setClass(statValue, "statValue");
            statValue.style.width = value + "%";
            statValue.innerHTML   = "&nbsp;";
            div.appendChild(statValue);
            target.appendChild(div);
            fixFontSize(span0, span);
        } else {
            throw new Error("Bug! Parser accepted an unknown row type: " + type);
        }
    }
    this.prevLine    = "block";
    this.screenEmpty = false;
};
Scene.prototype.parseStatChart      = function parseStatChart() {
    var nextIndent  = null;
    var rows        = [];
    var line, line1, line2, line2indent;
    var startIndent = this.indent;
    while (isDefined(line = this.lines[++this.lineNum])) {
        if (!trim(line)) {
            this.rollbackLineCoverage();
            continue;
        }
        var indent = this.getIndent(line);
        if (nextIndent === null || nextIndent === undefined) {
            if (indent <= startIndent) {
                throw new Error(this.lineMsg() + "invalid indent, expected at least one row");
            }
            this.indent = nextIndent = indent;
        }
        if (indent <= startIndent) {
            this.rollbackLineCoverage();
            this.lineNum--;
            this.rollbackLineCoverage();
            return rows;
        }
        if (indent != this.indent) {
            throw new Error(this.lineMsg() + "invalid indent, expected " + this.indent + ", was " + indent);
        }
        line       = trim(line);
        var result = /^(text|percent|opposed_pair)\s+(.*)/.exec(line);
        if (!result)throw new Error(this.lineMsg() + "invalid line; this line should start with 'percent', 'text', or 'opposed_pair'");
        var type = result[1].toLowerCase();
        var data = trim(result[2]);
        if ("opposed_pair" == type) {
            this.getVar(data);
            line1       = this.lines[++this.lineNum];
            this.replaceVariables(line1);
            line1indent = this.getIndent(line1);
            if (line1indent <= this.indent)throw new Error(this.lineMsg() + "invalid indent; expected at least one indented line to indicate opposed pair name. indent: " + line1indent + ", expected greater than " + this.indent);
            line2       = this.lines[this.lineNum + 1];
            line2indent = this.getIndent(line2);
            if (line2indent <= this.indent) {
                rows.push({ type : type, variable : data, label : data, opposed_label : trim(line1) });
            } else {
                this.lineNum++;
                this.replaceVariables(line2);
                if (line2indent == line1indent) {
                    rows.push({ type : type, variable : data, label : trim(line1), opposed_label : trim(line2) });
                } else if (line2indent > line1indent) {
                    var line1definition = line2;
                    var line3           = this.lines[++this.lineNum];
                    this.replaceVariables(line3);
                    var line3indent     = this.getIndent(line3);
                    if (line3indent != line1indent)throw new Error(this.lineMsg() + "invalid indent; this line should be the opposing label name. expected " + line1indent + " was " + line3indent);
                    var line4       = this.lines[++this.lineNum];
                    this.replaceVariables(line4);
                    var line4indent = this.getIndent(line4);
                    if (line4indent != line2indent)throw new Error(this.lineMsg() + "invalid indent; this line should be the opposing label definition. expected " + line2indent + " was " + line4indent);
                    rows.push({
                        type               : type,
                        variable           : data,
                        label              : trim(line1),
                        definition         : trim(line2),
                        opposed_label      : trim(line3),
                        opposed_definition : trim(line4)
                    });
                } else {
                    throw new Error(this.lineMsg() + "invalid indent; expected a second line with indent " + line1indent + " to match line " + this.lineNum + ", or else no more opposed_pair lines");
                }
            }
        } else {
            var variable, label;
            if (!/ /.test(data)) {
                variable = data;
                label    = data;
            } else {
                result = /^(\S+) (.*)/.exec(data);
                if (!result)throw new Error(this.lineMsg() + "Bug! can't find a space when a space was found");
                variable = result[1];
                label    = result[2];
            }
            this.getVar(variable);
            this.replaceVariables(label);
            line2       = this.lines[this.lineNum + 1];
            line2indent = this.getIndent(line2);
            if (line2indent <= this.indent) {
                rows.push({ type : type, variable : variable, label : label });
            } else {
                this.lineNum++;
                this.replaceVariables(line2);
                rows.push({ type : type, variable : variable, label : label, definition : trim(line2) });
            }
        }
    }
    return rows;
};
Scene.prototype.delay_break         = function (durationInSeconds) {
    if (isNaN(durationInSeconds * 1))throw new Error(this.lineMsg() + "invalid duration");
    this.finished   = true;
    this.skipFooter = true;
    var target      = this.target;
    if (!target) {
        target = document.createElement("p");
        document.getElementById('text').appendChild(target);
    }
    var self = this;
    delayBreakStart(function (delayStart) {
        var endTimeInSeconds = durationInSeconds * 1 + delayStart * 1;
        showTicker(target, endTimeInSeconds, function () {
            printButton("Next", target, false, function () {
                delayBreakEnd();
                self.finished = false;
                self.resetPage();
            });
        });
        printFooter();
    });
};
Scene.prototype.delay_ending        = function (data) {
    var args                = data.split(/ /);
    var durationInSeconds   = args[0];
    var fullPriceGuess      = args[1];
    var singleUsePriceGuess = args[2];
    if (isNaN(durationInSeconds * 1))throw new Error(this.lineMsg() + "invalid duration");
    if (!/^\$/.test(fullPriceGuess))throw new Error(this.lineMsg() + "invalid fullPriceGuess: \"" + fullPriceGuess + "\"");
    if (singleUsePriceGuess && !/^\$/.test(singleUsePriceGuess))throw new Error(this.lineMsg() + "invalid singleUsePriceGuess: \"" + singleUsePriceGuess + "\"");
    this.finished   = true;
    this.skipFooter = true;
    var self        = this;
    checkPurchase("adfree", function (ok, result) {
        if (result.adfree || !result.billingSupported || (typeof window != "undefined" && window.isWeb)) {
            self.ending();
            return;
        }
        getPrice("adfree", function (fullPrice) {
            if (fullPrice == "guess")fullPrice = fullPriceGuess;
            getPrice("skiponce", function (singleUsePrice) {
                if (singleUsePrice == "guess")singleUsePrice = singleUsePriceGuess;
                options             = [];
                var finishedWaiting = { name : "Play again after a short wait. ", unselectable : true };
                options.push(finishedWaiting);
                var upgradeSkip     = { name : "Upgrade to the unlimited version for " + fullPrice + " to skip the wait forever." };
                options.push(upgradeSkip);
                var skipOnce        = { name : "Skip the wait one time for " + singleUsePrice + "." };
                if (singleUsePriceGuess)options.push(skipOnce);
                var restorePurchasesOption = { name : "Restore purchases from another device." };
                if (isRestorePurchasesSupported())options.push(restorePurchasesOption);
                var playMoreGames = { name : "Play more games like this." };
                options.push(playMoreGames);
                var emailMe       = { name : "Email me when new games are available." };
                options.push(emailMe);
                self.paragraph();
                printOptions([""], options, function (option) {
                    if (option == playMoreGames) {
                        self.more_games("now");
                        if (typeof curl != "undefined")curl();
                    } else if (option == emailMe) {
                        subscribeLink();
                    } else if (option == upgradeSkip) {
                        purchase("adfree", function () {safeCall(self, function () {self.restart();});});
                    } else if (option == skipOnce) {
                        purchase("skiponce", function () {safeCall(self, function () {self.restart();});});
                    } else if (option == restorePurchasesOption) {
                        restorePurchases(function () {clearScreen(loadAndRestoreGame);});
                    } else {
                        self.restart();
                    }
                });
                var target        = document.getElementById("0").parentElement;
                delayBreakStart(function (delayStart) {
                    var endTimeInSeconds = durationInSeconds * 1 + delayStart * 1;
                    showTicker(target, endTimeInSeconds, function () {clearScreen(function () {self.ending();});});
                    printFooter();
                });
            });
        });
    });
};
Scene.prototype["if"]               = function scene_if(line) {
    var stack  = this.tokenizeExpr(line);
    var result = this.evaluateExpr(stack);
    if (this.debugMode)println(line + " :: " + result);
    result = bool(result, this.lineNum + 1);
    if (result) {
        this.indent = this.getIndent(this.nextNonBlankLine());
    } else {
        this.skipTrueBranch(false);
    }
};
Scene.prototype.skipTrueBranch      = function skipTrueBranch(inElse) {
    var startIndent = this.indent;
    var nextIndent  = null;
    while (isDefined(line = this.lines[++this.lineNum])) {
        this.rollbackLineCoverage();
        if (!trim(line))continue;
        var indent = this.getIndent(line);
        if (nextIndent === null || nextIndent === undefined) {
            if (indent <= startIndent)throw new Error(this.lineMsg() + "invalid indent, expected at least one line in 'if' true block");
            nextIndent = indent;
        }
        if (indent <= startIndent) {
            var parsed;
            if (indent == startIndent)parsed = /^\s*\*(\w+)(.*)/.exec(line);
            if (!parsed || inElse) {
                this.lineNum--;
                this.rollbackLineCoverage();
                this.indent = indent;
                return;
            }
            var command = parsed[1].toLowerCase();
            var data    = trim(parsed[2]);
            if ("else" == command) {
                if (data) {
                    if (/^if\b/.test(data)) {
                        throw new Error(this.lineMsg() + "'else if' is invalid, use 'elseif'");
                    }
                    throw new Error(this.lineMsg() + "nothing should appear on a line after 'else': " + data);
                }
                this.lineNum = this.lineNum;
                this.indent  = this.getIndent(this.nextNonBlankLine());
            } else if (/^else?if$/.test(command)) {
                this.lineNum = this.lineNum;
                this["if"](data);
            } else {
                this.lineNum--;
                this.rollbackLineCoverage();
                this.indent = this.getIndent(this.nextNonBlankLine());
            }
            return;
        }
        if (indent < nextIndent) {
            throw new Error(this.lineMsg() + "invalid indent, expected " + nextIndent + ", was " + indent);
        }
    }
};
Scene.prototype["else"]             = Scene.prototype.elsif = Scene.prototype.elseif = function scene_else(data, inChoice) {
    if (inChoice) {
        this.skipTrueBranch(true);
        return;
    }
    throw new Error(this.lineMsg() + "It is illegal to fall in to an *else statement; you must *goto or *finish before the end of the indented block.");
};
Scene.prototype.tokenizeExpr           = function tokenizeExpr(str) {
    var stack            = [];
    var tokenTypes       = Scene.tokens;
    var tokenTypesLength = tokenTypes.length;
    var pos              = 0;
    while (str) {
        var matched = false;
        for (var i = 0; i < tokenTypesLength; i++) {
            var tokenType = tokenTypes[i];
            var token     = tokenType.test(str, this.lineNum + 1);
            if (token) {
                matched = true;
                str     = str.substr(token.length);
                pos += token.length;
                if ("WHITESPACE" == tokenType.name) {
                    break;
                }
                stack.push({ name : tokenType.name, value : token, pos : pos });
                break;
            }
        }
        if (!matched)throw new Error(this.lineMsg() + "Invalid expression, couldn't extract another token: " + str);
    }
    return stack;
};
Scene.prototype.evaluateExpr           = function evaluateExpr(stack, parenthetical) {
    if (!stack.length) {
        throw new Error(this.lineMsg() + "no expression specified");
    }
    var self = this;

    function getToken() {
        var token = stack.shift();
        if (!token)throw new Error(self.lineMsg() + "null token");
        return token;
    }

    var token, value1, value2, operator, result;
    value1 = this.evaluateValueToken(getToken(), stack);
    if (!stack.length) {
        if (parenthetical) {
            throw new Error(this.lineMsg() + "Invalid expression, expected final closing parenthesis");
        }
        return value1;
    }
    token = getToken();
    if (parenthetical && parenthetical == token.name) {
        return value1;
    }
    operator = Scene.operators[token.value];
    if (!operator)throw new Error(this.lineMsg() + "Invalid expression at char " + token.pos + ", expected OPERATOR, was: " + token.name + " [" + token.value + "]");
    value2 = this.evaluateValueToken(getToken(), stack);
    result = operator(value1, value2, this.lineNum + 1);
    if (parenthetical) {
        if (stack.length) {
            token = getToken();
            if (parenthetical == token.name) {
                return result;
            } else {
                throw new Error(this.lineMsg() + "Invalid expression at char " + token.pos + ", expected closing parenthesis, was: " + token.name + " [" + token.value + "]");
            }
        } else {
            throw new Error(this.lineMsg() + "Invalid expression, expected final closing parenthesis");
        }
    } else {
        if (stack.length) {
            token = getToken();
            throw new Error(this.lineMsg() + "Invalid expression at char " + token.pos + ", expected no more tokens, found: " + token.name + " [" + token.value + "]");
        } else {
            return result;
        }
    }
    throw new Error(this.lineMsg() + "bug, how did I get here?");
};
Scene.prototype.evaluateValueToken     = function evaluateValueToken(token, stack) {
    var name = token.name;
    var value;
    if ("OPEN_PARENTHESIS" == name) {
        return this.evaluateExpr(stack, "CLOSE_PARENTHESIS");
    } else if ("OPEN_CURLY" == name) {
        value = this.evaluateExpr(stack, "CLOSE_CURLY");
        return this.getVar(value);
    } else if ("FUNCTION" == name) {
        var functionName = /^\w+/.exec(token.value)[0];
        if (!this.functions[functionName])throw new Error(this.lineMsg + "Unknown function " + functionName);
        value = this.evaluateExpr(stack, "CLOSE_PARENTHESIS");
        return this.functions[functionName].call(this, value);
    } else if ("NUMBER" == name) {
        return token.value;
    } else if ("STRING" == name) {
        return this.replaceVariables(token.value.slice(1, -1).replace(/\\(.)/g, "$1"));
    } else if ("VAR" == name) {
        return this.getVar(token.value);
    } else {
        throw new Error(this.lineMsg() + "Invalid expression at char " + token.pos + ", expected NUMBER, STRING, VAR or PARENTHETICAL, was: " + name + " [" + token.value + "]");
    }
};
Scene.prototype.functions              = {
    not       : function (value) {return !bool(value, this.lineNum + 1);},
    round     : function (value) {
        if (isNaN(value * 1))throw new Error(this.lineMsg() + "round() value is not a number: " + value);
        return Math.round(value);
    },
    timestamp : function (value) {
        return Date.parse(value) / 1000;
    },
    log       : function (value) {
        if (isNaN(value * 1))throw new Error(this.lineMsg() + "log() value is not a number: " + value);
        return Math.log(value) / Math.log(10);
    }
};
Scene.prototype.evaluateValueExpr      = function evaluateValueExpr(expr) {
    var stack = this.tokenizeExpr(expr);
    var token = stack.shift();
    if (!token)throw new Error(this.lineMsg() + "null token");
    var value = this.evaluateValueToken(token, stack);
    if (stack.length) {
        token = stack.shift();
        if (!token)throw new Error(this.lineMsg() + "null token");
        throw new Error(this.lineMsg() + "Invalid expression at char " + token.pos + ", expected no more tokens, found: " + token.name + " [" + token.value + "]");
    }
    return value;
};
Scene.prototype.goto_random_scene      = function gotoRandomScene(data) {
    var parsed             = this.parseGotoRandomScene(data);
    var allowReuseGlobally = /\ballow_reuse\b/.test(data);
    var allowNoSelection   = /\ballow_no_selection\b/.test(data);
    var option             = this.computeRandomSelection(Math.random(), parsed, allowReuseGlobally);
    if (option) {
        this.goto_scene(option.name);
    } else {
        if (allowNoSelection) {
            return;
        } else {
            throw new Error(this.lineMsg() + "No selectable scenes");
        }
    }
};
Scene.prototype.parseGotoRandomScene   = function parseGotoRandomScene(data) {
    data                   = data || "";
    var directives         = data.split(" ");
    var allowReuseGlobally = false;
    var allowNoSelection   = false;
    for (var i = 0; i < directives; i++) {
        var directive = trim(directives[i]);
        if (!directive)continue;
        if (directive == "allow_reuse") {
            allowReuseGlobally = true;
        } else if (directive == "allow_no_selection") {
            allowNoSelection = true;
        } else {
            throw new Error(this.lineMsg() + "invalid command: '" + directive + "'");
        }
    }
    var nextIndent  = null;
    var options     = [];
    var line;
    var startIndent = this.indent;
    while (isDefined(line = this.lines[++this.lineNum])) {
        if (!trim(line)) {
            this.rollbackLineCoverage();
            continue;
        }
        var indent = this.getIndent(line);
        if (nextIndent === null || nextIndent === undefined) {
            if (indent <= startIndent) {
                throw new Error(this.lineMsg() + "invalid indent, expected at least one line in *goto_random_scene");
            }
            this.indent = nextIndent = indent;
        }
        if (indent <= startIndent) {
            this.rollbackLineCoverage();
            this.lineNum--;
            this.rollbackLineCoverage();
            break;
        }
        if (indent != this.indent) {
            throw new Error(this.lineMsg() + "invalid indent, expected " + this.indent + ", was " + indent);
        }
        line       = trim(line);
        var option = { allowReuse : allowReuseGlobally };
        var command;
        while (!!(command = /^\*(\S+)/.exec(line))) {
            command = command[1];
            if ("allow_reuse" == command) {
                option.allowReuse = true;
                line              = trim(line.substring("*allow_reuse".length));
                command           = /^\*(\S+)/.exec(line);
                continue;
            } else if ("if" == command) {
                var conditional = /^\*if\s+\((.+)\)\s+([^\)]+)/.exec(line);
                if (!conditional)throw new Error(this.lineMsg() + " invalid *if, expected () followed by scene name: " + line);
                line               = conditional[2];
                var stack          = this.tokenizeExpr(conditional[1]);
                this.evaluateExpr(stack);
                option.conditional = conditional[1];
            } else {
                throw new Error(this.lineMsg() + " invalid command: " + line);
            }
        }
        option.name = trim(line);
        options.push(option);
    }
    return options;
};
Scene.prototype.computeRandomSelection = function computeRandomSelection(randomFloat, options, allowReuseGlobally) {
    var filtered = [];
    var finished = {};
    if (!allowReuseGlobally) {
        if (!this.stats.choice_grs)this.stats.choice_grs = [];
    }
    var grs = this.stats.choice_grs;
    for (var i = 0; i < grs.length; i++) {
        finished[grs[i]] = 1;
    }
    var option;
    for (i = 0; i < options.length; i++) {
        option = options[i];
        if (!option.allowReuse) {
            if (finished[option.name])continue;
        }
        if (option.conditional) {
            var stack = this.tokenizeExpr(option.conditional);
            var pass  = this.evaluateExpr(stack);
            if (!pass)continue;
        }
        filtered.push(option);
    }
    if (!filtered.length)return null;
    var randomSelection = Math.floor(randomFloat * filtered.length);
    option              = filtered[randomSelection];
    if (!option.allowReuse) {
        this.stats.choice_grs.push(option.name);
    }
    return option;
};
Scene.prototype.end_trial              = function endTrial() {
    this.paragraph();
    printLink(this.target, "#", "Start Over from the Beginning", function (e) {
        preventDefault(e);
        return restartGame("prompt");
    });
    this.prevLine    = "block";
    this.screenEmpty = false;
    this.finished    = true;
};
Scene.prototype.achieve                = function scene_achieve(name) {
    name = name.toLowerCase();
    if (!this.nav.achievements.hasOwnProperty(name)) {
        throw new Error(this.lineMsg() + "the achievement name " + name + " was not declared as an *achievement in startup");
    }
    var achievement         = this.nav.achievements[name];
    this.nav.achieved[name] = true;
    if (typeof window != "undefined" && typeof achieve != "undefined") {
        achieve(name, achievement.title, achievement.earnedDescription);
    }
};
Scene.prototype.check_achievements     = function scene_checkAchievements() {
    var self = this;

    function callback(immediately) {
        for (var achievement in nav.achievements) {
            self.temps["choice_achieved_" + achievement] = nav.achieved.hasOwnProperty(achievement);
        }
        if (!immediately) {
            self.finished   = false;
            self.skipFooter = false;
            self.execute();
        }
    }

    if (typeof checkAchievements == "undefined") {
        callback("immediately");
    } else {
        this.finished   = true;
        this.skipFooter = true;
        checkAchievements(callback);
    }
};
Scene.prototype.scene_list             = function scene_list() {
    var scenes = this.parseSceneList();
    this.nav.setSceneList(scenes);
};
Scene.prototype.parseSceneList         = function parseSceneList() {
    var nextIndent  = null;
    var scenes      = [];
    var line;
    var startIndent = this.indent;
    while (isDefined(line = this.lines[++this.lineNum])) {
        if (!trim(line)) {
            this.rollbackLineCoverage();
            continue;
        }
        var indent = this.getIndent(line);
        if (nextIndent === null || nextIndent === undefined) {
            if (indent <= startIndent) {
                throw new Error(this.lineMsg() + "invalid indent, expected at least one row");
            }
            this.indent = nextIndent = indent;
        }
        if (indent <= startIndent) {
            this.rollbackLineCoverage();
            this.lineNum--;
            this.rollbackLineCoverage();
            return scenes;
        }
        if (indent != this.indent) {
            throw new Error(this.lineMsg() + "invalid indent, expected " + this.indent + ", was " + indent);
        }
        line              = trim(line);
        var purchaseMatch = /^\$(\w*)\s+(.*)/.exec(line);
        if (purchaseMatch) {
            line = purchaseMatch[2];
        }
        if (!scenes.length && "startup" != line)scenes.push("startup");
        scenes.push(line);
    }
    return scenes;
};
Scene.prototype.title                  = function scene_title(title) {
    if (typeof changeTitle != "undefined") {
        changeTitle(title);
    }
};
Scene.prototype.author                 = function scene_author(author) {
    if (typeof changeAuthor != "undefined") {
        changeAuthor(author);
    }
};
Scene.prototype.achievement            = function scene_achievement(data) {
    var parsed = /(\S+)\s+(\S+)\s+(\S+)\s+(.*)/.exec(data);
    if (!parsed)throw new Error(this.lineMsg() + "Invalid *achievement, requires short name, visibility, points, and display title: " + data);
    var achievementName = parsed[1];
    if (!/^[a-z][a-z0-9_]+$/.test(achievementName))throw new Error(this.lineMsg() + "Invalid achievement name: " + achievementName);
    if (this.nav.achievements.hasOwnProperty(achievementName)) {
        if (!this.nav.achievements[achievementName].lineNumber) {
            this.nav.achievements    = {};
            this.nav.achievementList = [];
        } else if (this.nav.achievements[achievementName].lineNumber != (this.lineNum + 1)) {
            throw new Error(this.lineMsg() + "Achievement " + achievementName + " already defined on line " + this.nav.achievements[achievementName].lineNumber);
        }
    }
    var lineNumber = this.lineNum + 1;
    var visibility = parsed[2];
    if (visibility != "hidden" && visibility != "visible") {
        throw new Error(this.lineMsg() + "Invalid *achievement, the second word should be either 'hidden' or 'visible': " + visibility);
    }
    var visible     = (visibility != "hidden");
    var pointString = parsed[3];
    if (!/[1-9][0-9]*/.test(pointString)) {
        throw new Error(this.lineMsg() + "Invalid *achievement, the third word should be an integer number of points: " + pointString);
    }
    var points = parseInt(pointString, 10);
    if (points > 100)throw new Error(this.lineMsg() + "Invalid *achievement, no achievement may be worth more than 100 points: " + points);
    if (!this.achievementTotal)this.achievementTotal = 0;
    this.achievementTotal += points;
    if (this.achievementTotal > 1000) {
        throw new Error(this.lineMsg() + "Invalid achievements. Adding " + points + " would add up to more than 1,000 points: " + this.achievementTotal);
    }
    var title = parsed[4];
    if (/(\$\{)/.test(title))throw new Error(this.lineMsg() + "Invalid *achievement. ${} not permitted in achievement title: " + title);
    if (/(\[)/.test(title))throw new Error(this.lineMsg() + "Invalid *achievement. [] not permitted in achievement title: " + title);
    var line   = this.lines[++this.lineNum];
    var indent = this.getIndent(line);
    if (!indent) {
        throw new Error(this.lineMsg() + "Invalid *achievement. An indented description is required.");
    }
    var preEarnedDescription = trim(line);
    if (/(\$\{)/.test(preEarnedDescription))throw new Error(this.lineMsg() + "Invalid *achievement. ${} not permitted in achievement description: " + preEarnedDescription);
    if (/(\[)/.test(preEarnedDescription))throw new Error(this.lineMsg() + "Invalid *achievement. [] not permitted in achievement description: " + preEarnedDescription);
    if (!visible) {
        if (preEarnedDescription.toLowerCase() != "hidden")throw new Error(this.lineMsg() + "Invalid *achievement. Hidden achievements must set their pre-earned description to 'hidden'.");
    }
    var postEarnedDescription = null;
    while (isDefined(line = this.lines[++this.lineNum])) {
        if (trim(line))break;
        this.rollbackLineCoverage();
    }
    indent = this.getIndent(line);
    if (indent) {
        postEarnedDescription = trim(line);
        if (/(\$\{)/.test(postEarnedDescription))throw new Error(this.lineMsg() + "Invalid *achievement. ${} not permitted in achievement description: " + postEarnedDescription);
        if (/(\[)/.test(postEarnedDescription))throw new Error(this.lineMsg() + "Invalid *achievement. [] not permitted in achievement description: " + postEarnedDescription);
    } else {
        this.rollbackLineCoverage();
        this.lineNum--;
        this.rollbackLineCoverage();
    }
    if (!postEarnedDescription) {
        if (!visible)throw new Error(this.lineMsg() + "Invalid *achievement. Hidden achievements must set a post-earned description.");
        postEarnedDescription = preEarnedDescription;
    }
    if (!this.nav.achievements.hasOwnProperty(achievementName)) {
        this.nav.achievementList.push(achievementName);
        if (this.nav.achievementList.length > 100) {
            throw new Error(this.lineMsg() + "Too many *achievements. Each game can have up to 100 achievements.");
        }
    }
    if (!this.seenAchievementTitles)this.seenAchievementTitles = {};
    if (this.seenAchievementTitles[title]) {
        throw new Error(this.lineMsg() + "An achievement with display title \"" + title + "\" was already defined at line " + this.seenAchievementTitles[title]);
    }
    this.seenAchievementTitles[title]      = this.lineNum + 1;
    this.nav.achievements[achievementName] = {
        visible              : visible,
        points               : points,
        title                : title,
        earnedDescription    : postEarnedDescription,
        preEarnedDescription : preEarnedDescription,
        lineNumber           : lineNumber
    };
    if (typeof setButtonTitles != "undefined")setButtonTitles();
};
Scene.prototype.bug                    = function scene_bug(message) {
    if (message) {
        message = "Bug: " + this.replaceVariables(message);
    } else {
        message = "Bug";
    }
    throw new Error(this.lineMsg() + message);
};
Scene.prototype.lineMsg                = function lineMsg() {return this.name + " line " + (this.lineNum + 1) + ": ";};
Scene.prototype.rollbackLineCoverage   = function () {};
Scene.baseUrl                          = "scenes";
Scene.regexpMatch                      = function regexpMatch(str, re) {
    var result = re.exec(str);
    if (!result)return null;
    return result[0];
};
Scene.tokens                           = [{
    name : "OPEN_PARENTHESIS",
    test : function (str) {return Scene.regexpMatch(str, /^\(/);}
}, { name : "CLOSE_PARENTHESIS", test : function (str) {return Scene.regexpMatch(str, /^\)/);} }, {
    name : "OPEN_CURLY",
    test : function (str) {return Scene.regexpMatch(str, /^\{/);}
}, { name : "CLOSE_CURLY", test : function (str) {return Scene.regexpMatch(str, /^\}/);} }, {
    name : "FUNCTION",
    test : function (str) {return Scene.regexpMatch(str, /^(not|round|timestamp|log)\s*\(/);}
}, { name : "NUMBER", test : function (str) {return Scene.regexpMatch(str, /^\d+(\.\d+)?/);} }, {
    name : "STRING", test : function (str, line) {
        var i;
        if (!/^\"/.test(str))return null;
        for (i = 1; i < str.length; i++) {
            var x = str.charAt(i);
            if ("\\" == x) {
                i++;
            } else if ('"' == x) {
                return str.substring(0, i + 1);
            }
        }
        throw new Error("line " + line + ": Invalid string, open quote with no close quote: " + str);
    }
}, { name : "WHITESPACE", test : function (str) {return Scene.regexpMatch(str, /^\s+/);} }, {
    name : "BOOLEAN_OPERATOR",
    test : function (str) {return Scene.regexpMatch(str, /^(and|or)\b/);}
}, { name : "VAR", test : function (str) {return Scene.regexpMatch(str, /^[a-zA-Z]\w*/);} }, {
    name : "FAIRMATH",
    test : function (str) {return Scene.regexpMatch(str, /^%[\+\-]/);}
}, {
    name : "OPERATOR",
    test : function (str) {return Scene.regexpMatch(str, /^[\+\-\*\/\&\%\^]/);}
}, { name : "INEQUALITY", test : function (str) {return Scene.regexpMatch(str, /^[\!<>]\=?/);} }, {
    name : "EQUALITY",
    test : function (str) {return Scene.regexpMatch(str, /^=/);}
}];
Scene.operators                        = {
    "+"   : function add(v1, v2, line) {return num(v1, line) + num(v2, line);},
    "-"   : function subtract(v1, v2, line) {return num(v1, line) - num(v2, line);},
    "*"   : function multiply(v1, v2, line) {return num(v1, line) * num(v2, line);},
    "/"   : function divide(v1, v2, line) {return num(v1, line) / num(v2, line); },
    "%"   : function modulo(v1, v2, line) {return num(v1, line) % num(v2, line);},
    "^"   : function exponent(v1, v2, line) {return Math.pow(num(v1, line), num(v2, line));},
    "&"   : function concatenate(v1, v2) {return [v1, v2].join("");},
    "%+"  : function fairAdd(v1, v2, line) {
        v1             = num(v1, line);
        v2             = num(v2, line);
        var validValue = (v1 >= 0 && v1 <= 100);
        if (!validValue) {
            throw new Error("line " + line + ": Can't fairAdd to non-percentile value: " + v1);
        }
        var multiplier     = (100 - v1) / 100;
        var actualModifier = v2 * multiplier;
        var value          = 1 * v1 + actualModifier;
        value              = Math.floor(value);
        if (value > 99)value = 99;
        return value;
    },
    "%-"  : function fairSubtract(v1, v2, line) {
        v1             = num(v1, line);
        v2             = num(v2, line);
        var validValue = (v1 >= 0 && v1 <= 100);
        if (!validValue) {
            throw new Error("line " + line + ": Can't fairAdd to non-percentile value: " + v1);
        }
        var multiplier     = v1 / 100;
        var actualModifier = v2 * multiplier;
        var value          = v1 - actualModifier;
        value              = Math.ceil(value);
        if (value < 1)value = 1;
        return value;
    },
    "="   : function equals(v1, v2) {return v1 == v2;},
    "<"   : function lessThan(v1, v2, line) {return num(v1, line) < num(v2, line);},
    ">"   : function greaterThan(v1, v2, line) {return num(v1, line) > num(v2, line);},
    "<="  : function lessThanOrEquals(v1, v2, line) {return num(v1, line) <= num(v2, line);},
    ">="  : function greaterThanOrEquals(v1, v2, line) {return num(v1, line) >= num(v2, line);},
    "!="  : function notEquals(v1, v2) {return v1 != v2;},
    "and" : function and(v1, v2, line) {return bool(v1, line) && bool(v2, line);},
    "or"  : function or(v1, v2, line) {return bool(v1, line) || bool(v2, line);}
};
Scene.initialCommands                  = {
    "create"      : 1,
    "scene_list"  : 1,
    "title"       : 1,
    "author"      : 1,
    "comment"     : 1,
    "achievement" : 1
};
Scene.validCommands                    = {
    "comment"            : 1,
    "goto"               : 1,
    "gotoref"            : 1,
    "label"              : 1,
    "looplimit"          : 1,
    "finish"             : 1,
    "abort"              : 1,
    "choice"             : 1,
    "create"             : 1,
    "temp"               : 1,
    "delete"             : 1,
    "set"                : 1,
    "setref"             : 1,
    "print"              : 1,
    "if"                 : 1,
    "rand"               : 1,
    "page_break"         : 1,
    "line_break"         : 1,
    "script"             : 1,
    "else"               : 1,
    "elseif"             : 1,
    "elsif"              : 1,
    "reset"              : 1,
    "goto_scene"         : 1,
    "fake_choice"        : 1,
    "input_text"         : 1,
    "ending"             : 1,
    "share_this_game"    : 1,
    "stat_chart"         : 1,
    "subscribe"          : 1,
    "show_password"      : 1,
    "gosub"              : 1,
    "return"             : 1,
    "hide_reuse"         : 1,
    "disable_reuse"      : 1,
    "allow_reuse"        : 1,
    "check_purchase"     : 1,
    "restore_purchases"  : 1,
    "purchase"           : 1,
    "restore_game"       : 1,
    "advertisement"      : 1,
    "kindle_search"      : 1,
    "kindle_product"     : 1,
    "save_game"          : 1,
    "delay_break"        : 1,
    "image"              : 1,
    "kindle_image"       : 1,
    "link"               : 1,
    "input_number"       : 1,
    "goto_random_scene"  : 1,
    "restart"            : 1,
    "more_games"         : 1,
    "delay_ending"       : 1,
    "end_trial"          : 1,
    "login"              : 1,
    "achieve"            : 1,
    "scene_list"         : 1,
    "title"              : 1,
    "bug"                : 1,
    "link_button"        : 1,
    "check_registration" : 1,
    "sound"              : 1,
    "author"             : 1,
    "gosub_scene"        : 1,
    "achievement"        : 1,
    "check_achievements" : 1,
    "redirect_scene"     : 1
};
Scene.validCommands.lifemap            = 1;
Scene.prototype.lifemap                = function lifemap(data) {
    $('.stat_diff').remove();

    // Create lastStats if none exists
    if (!lastStats) {
        lastStats = $.extend({}, stats);
    }

    var inverseStyle       = document.createElement("style");
    inverseStyle.setAttribute("id", "inverseStyle");
    inverseStyle.innerHTML = "body { background-color: black; color: white; } a { color: #0099ff; }";
    main.insertBefore(inverseStyle, main.firstChild);
    this.finished          = true;
    var data               = eval("(" + data + ")");
    var grid               = data.lifeMap;
    var gridSides          = data.lifeMapSides;
    var doc                = document;
    if (this.stats.debug)println(toJson(this.stats));
    textBuilder      = ["<table border=0 cellspacing=0 cellpadding=0"];
    if (innerWidth < 640 && innerWidth > 320) {
        textBuilder.push(" style='zoom: ");
        textBuilder.push(innerWidth / 320);
        textBuilder.push("'");
    }
    textBuilder.push("><tbody>");
    var focused      = null;
    var finishedSet  = {};
    var finishedList = this.stats.finished.split(",");
    for (var i = finishedList.length - 1; i >= 0; i--) {
        var vig = finishedList[i];
        if (!vig)continue;
        finishedSet[vig] = 1;
    }

    var firstRowEmpty = true;
    while (firstRowEmpty && grid.length >= 5) {
        for (var columnNum = 1; firstRowEmpty && columnNum < 4; columnNum++) {
            var icon = grid[0][columnNum];
            if (icon && icon.name && !this.stats.finished[icon.vignette]) {
                firstRowEmpty = false;
            }
        }
        if (firstRowEmpty)grid.shift();
    }
    for (var rowNum = 0; rowNum < grid.length; rowNum++) {
        textBuilder.push("<tr>");
        var icon = gridSides[rowNum] ? gridSides[rowNum][0] : null;
        this.printTableCell(textBuilder, icon, true);
        for (var columnNum = 1; columnNum < 4; columnNum++) {
            var icon = grid[rowNum][columnNum];
            var skip = icon && finishedSet[icon.vignette];
            focused  = this.printTableCell(textBuilder, icon, focused, skip);
        }
        var icon = gridSides[rowNum] ? gridSides[rowNum][4] : null;
        this.printTableCell(textBuilder, icon, true);
        textBuilder.push("</tr>\n");
    }
    textBuilder.push("</tbody></table>");
    var frag        = document.createElement("div");
    frag.innerHTML  = textBuilder.join("");
    var target      = this.target;
    if (!target)target = document.getElementById("text");
    target.appendChild(frag);

    addStatDiffTable();

    window.lifeMapCallback = function (vig) {
        $('.stat_diff').remove();

        // Save last stats so can see the difference after the scene
        lastStats = $.extend({}, stats);

        function executeScene() {
            clearScreen(function () {
                window.stats.vig = vig;
                var sceneName    = window.stats.gender + "-" + vig;
                var scene        = new Scene(sceneName, window.stats, window.stats.scene.nav, window.stats.scene.debugMode);
                scene.save(function () {
                    scene.setVar("vig", vig);
                    scene.resetPage();
                }, "");
            });
        }

        if (window.isIosApp) {
            window.freezeCallback = function () {
                window.freezeCallback = null;
                executeScene();
            }
            callIos("freeze");
        } else {
            executeScene();
        }
    }
}
Scene.prototype.printTableCell         = function printTableCell(textBuilder, icon, focused, skip) {
    var cellSize  = 64;
    var imageSize = 45;
    var bigIcons  = innerWidth > 640;
    if (bigIcons) {
        cellSize *= 2;
        imageSize *= 2;
    }
    textBuilder.push("  <td align='center' valign='middle' width='" + cellSize + "' height='" + cellSize + "' background='");
    var dirs      = 0;
    var iconName  = "";
    var iconVig;
    if (icon) {
        dirs     = icon.dirs;
        iconName = icon.name;
        iconVig  = icon.vignette;
        if (!iconVig) {
            if (icon.sicFileName) {
                iconVig = icon.sicFileName;
                iconVig = iconVig.substring(0, iconVig.length - 4).toLowerCase();
            } else {
                iconVig = { age : "time", stats : "stats", school : "highschool", risks : "risks" }[iconName];
            }
        }
    }
    textBuilder.push(dirs);
    if (bigIcons) {
        textBuilder.push(".png'>");
    } else {
        textBuilder.push("_small.gif'>");
    }
    if (iconName && !skip) {
        textBuilder.push("<a href='javascript:void(0);' style='border:0' data-name='" + iconName + "'");
        if (!focused) {
            focused = true;
            textBuilder.push("accesskey='n' ");
        }
        textBuilder.push("onclick='preventDefault(event); lifeMapCallback(\"");
        textBuilder.push(iconVig);
        textBuilder.push("\");'><img src='");
        textBuilder.push(iconName);
        textBuilder.push("_180.png");
        textBuilder.push("' border='0' alt='");
        textBuilder.push(iconName);
        textBuilder.push("' title='" + iconName + "'");
        textBuilder.push("' height='" + imageSize + "' width='" + imageSize + "' style='margin:" + (-imageSize * 0.5) + "px'></a>");
    }
    textBuilder.push("</td>\n\n\n\n");
    return focused;
}