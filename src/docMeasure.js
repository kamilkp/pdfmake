/* jslint node: true */
'use strict';

var TextTools = require('./textTools');
var StyleContextStack = require('./styleContextStack');
var fontStringify = require('./helpers').fontStringify;

/**
* @private
*/
function DocMeasure(fontProvider, styleDictionary, defaultStyle) {
	this.textTools = new TextTools(fontProvider);
	this.styleStack = new StyleContextStack(styleDictionary, defaultStyle);
}

/**
* Measures all nodes and sets min/max-width properties required for the second
* layout-pass.
* @param  {Object} docStructure document-definition-object
* @return {Object}              document-measurement-object
*/
DocMeasure.prototype.measureDocument = function(docStructure) {
	return this.measureNode(docStructure);
};

DocMeasure.prototype.measureNode = function(node) {
	// expand shortcuts
	if (node instanceof Array) {
		node = { stack: node };
	} else if (typeof node == 'string' || node instanceof String) {
		node = { text: node };
	}

	var self = this;

	return this.styleStack.auto(node, function() {
		// TODO: refactor + rethink whether this is the proper way to handle margins
		node._margin = getNodeMargin(node);

		if (node.columns) {
			return extendMargins(self.measureColumns(node));
		} else if (node.stack) {
			return extendMargins(self.measureVerticalContainer(node));
		} else if (node.ul) {
			return extendMargins(self.measureList(false, node));
		} else if (node.ol) {
			return extendMargins(self.measureList(true, node));
		} else if (node.table) {
			return extendMargins(self.measureTable(node));
		} else if (node.text) {
			return extendMargins(self.measureLeaf(node));
		} else if (node.canvas) {
			return extendMargins(self.measureCanvas(node));
		} else {
			throw 'Unrecognized document structure: ' + JSON.stringify(node, fontStringify);
		}
	});

	function extendMargins(node) {
		var margin = node._margin;

		if (margin) {
			node._minWidth += margin[0] + margin[2];
			node._maxWidth += margin[0] + margin[2];
		}

		return node;
	}

	function getNodeMargin() {
		var margin = node.margin;

		if (!margin && node.style) {
			var styleArray = (node.style instanceof Array) ? node.style : [ node.style ];

			for(var i = styleArray.length - 1; i >= 0; i--) {
				var styleName = styleArray[i];
				var style = self.styleStack.styleDictionary[node.style];
				if (style && style.margin) {
					margin = style.margin;
					break;
				}
			}
		}

		if (!margin) return null;

		if (typeof margin === 'number' || margin instanceof Number) {
			margin = [ margin, margin, margin, margin ];
		} else if (margin instanceof Array) {
			if (margin.length === 2) {
				margin = [ margin[0], margin[1], margin[0], margin[1] ];
			}
		}

		return margin;
	}
};

DocMeasure.prototype.measureLeaf = function(node) {
	var data = this.textTools.buildInlines(node.text, this.styleStack);

	node._inlines = data.items;
	node._minWidth = data.minWidth;
	node._maxWidth = data.maxWidth;

	return node;
};

DocMeasure.prototype.measureVerticalContainer = function(node) {
	var items = node.stack;

	node._minWidth = 0;
	node._maxWidth = 0;

	for(var i = 0, l = items.length; i < l; i++) {
		items[i] = this.measureNode(items[i]);

		node._minWidth = Math.max(node._minWidth, items[i]._minWidth);
		node._maxWidth = Math.max(node._maxWidth, items[i]._maxWidth);
	}

	return node;
};

DocMeasure.prototype.measureColumns = function(node) {
	var columns = node.columns;
	node._minWidth = 0;
	node._maxWidth = 0;
	node._gap = this.styleStack.getProperty('columnGap');

	for(var i = 0, l = columns.length; i < l; i++) {
		columns[i] = this.measureNode(columns[i]);

		node._minWidth += columns[i]._minWidth;
		node._maxWidth += columns[i]._maxWidth;
	}

	return node;
};

DocMeasure.prototype.gapSizeForList = function(isOrderedList, listItems) {
	if (isOrderedList) {
		var longestNo = (listItems.length).toString().replace(/./g, '9');
		return this.textTools.sizeOfString(longestNo + '. ', this.styleStack);
	} else {
		return this.textTools.sizeOfString('9. ', this.styleStack);
	}
};

DocMeasure.prototype.buildMarker = function(isOrderedList, counter, styleStack, gapSize) {
	var marker;

	if (isOrderedList) {
		marker = { _inlines: this.textTools.buildInlines(counter, styleStack).items };
	}
	else {
		// TODO: ascender-based calculations
		var radius = gapSize.fontSize / 6;

		marker = {
			canvas: [ {
				x: radius,
				y: gapSize.height + gapSize.decender - gapSize.fontSize / 3,//0,// gapSize.fontSize * 2 / 3,
				r1: radius,
				r2: radius,
				type: 'ellipse',
				color: 'black'
			} ]
		};
	}

	marker._minWidth = marker._maxWidth = gapSize.width;
	marker._minHeight = marker._maxHeight = gapSize.height;

	return marker;
};

DocMeasure.prototype.measureList = function(isOrdered, node) {
	var style = this.styleStack.clone();

	var items = isOrdered ? node.ol : node.ul;
	node._gapSize = this.gapSizeForList(isOrdered, items);
	node._minWidth = 0;
	node._maxWidth = 0;

	var counter = 1;

	for(var i = 0, l = items.length; i < l; i++) {
		var nextItem = items[i] = this.measureNode(items[i]);

		var marker = counter++ + '. ';

		if (!nextItem.ol && !nextItem.ul) {
			nextItem.listMarker = this.buildMarker(isOrdered, nextItem.counter || marker, style, node._gapSize);
		}  // TODO: else - nested lists numbering


		node._minWidth = Math.max(node._minWidth, items[i]._minWidth + node._gapSize.width);
		node._maxWidth = Math.max(node._maxWidth, items[i]._maxWidth + node._gapSize.width);
	}

	return node;
};

DocMeasure.prototype.measureTable = function(node) {
	extendTableWidths(node);

	node.table._minWidth = 0;
	node.table._maxWidth = 0;

	for(var col = 0, cols = node.table.body[0].length; col < cols; col++) {
		node.table.widths[col]._minWidth = 0;
		node.table.widths[col]._maxWidth = 0;

		for(var row = 0, rows = node.table.body.length; row < rows; row++) {
			node.table.body[row][col] = this.measureNode(node.table.body[row][col]);

			node.table.widths[col]._minWidth = Math.max(node.table.widths[col]._minWidth, node.table.body[row][col]._minWidth);
			node.table.widths[col]._maxWidth = Math.max(node.table.widths[col]._maxWidth, node.table.body[row][col]._maxWidth);
		}

		node.table._minWidth += node.table.widths[col]._minWidth;
		node.table._maxWidth += node.table.widths[col]._maxWidth;
	}

	return node;

	function extendTableWidths(node) {
		if (!node.table.widths) {
			node.table.widths = 'auto';
		}

		if (typeof node.table.widths === 'string' || node.table.widths instanceof String) {
			node.table.widths = [ node.table.widths ];

			while(node.table.widths.length < node.table.body[0].length) {
				node.table.widths.push(node.table.widths[node.table.widths.length - 1]);
			}
		}

		for(var i = 0, l = node.table.widths.length; i < l; i++) {
			var w = node.table.widths[i];
			if (typeof w === 'number' || w instanceof Number || typeof w === 'string' || w instanceof String) {
				node.table.widths[i] = { width: w };
			}
		}
	}
};

DocMeasure.prototype.measureCanvas = function(node) {
	var w = 0, h = 0;

	for(var i = 0, l = node.canvas.length; i < l; i++) {
		var vector = node.canvas[i];

		switch(vector.type) {
		case 'ellipse':
			w = Math.max(w, vector.x + vector.r1);
			h = Math.max(h, vector.y + vector.r2);
			break;
		case 'rect':
			w = Math.max(w, vector.x + vector.w);
			h = Math.max(h, vector.y + vector.h);
			break;
		case 'line':
			w = Math.max(w, vector.x1, vector.x2);
			h = Math.max(h, vector.y1, vector.y2);
			break;
		case 'polyline':
			for(var i2 = 0, l2 = vector.points.length; i2 < l2; i2++) {
				w = Math.max(w, vector.points[i2].x);
				h = Math.max(h, vector.points[i2].y);
			}
			break;
		}
	}

	node._minWidth = node._maxWidth = w;
	node._minHeight = node._maxHeight = h;

	return node;
};

module.exports = DocMeasure;
