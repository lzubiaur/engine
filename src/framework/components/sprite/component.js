pc.extend(pc, function () {
    'use strict';

    /**
     * @private
     * @enum pc.SPRITETYPE
     * @name pc.SPRITETYPE_SIMPLE
     * @description A {@link pc.SpriteComponent} that displays a single frame from a sprite asset.
     */
    pc.SPRITETYPE_SIMPLE = 'simple';


    /**
     * @private
     * @enum pc.SPRITETYPE
     * @name pc.SPRITETYPE_ANIMATED
     * @description A {@link pc.SpriteComponent} that renders sprite animations.
     */
    pc.SPRITETYPE_ANIMATED = 'animated';

    var PARAM_EMISSIVE_MAP = 'texture_emissiveMap';
    var PARAM_OPACITY_MAP = 'texture_opacityMap';
    var PARAM_EMISSIVE = 'material_emissive';
    var PARAM_OPACITY = 'material_opacity';
    var PARAM_INNER_OFFSET = 'innerOffset';
    var PARAM_OUTER_SCALE = 'outerScale';
    var PARAM_ATLAS_RECT = 'atlasRect';

    /**
     * @private
     * @component
     * @constructor
     * @name pc.SpriteComponent
     * @extends pc.Component
     * @classdesc Enables an Entity to render a simple static sprite or sprite animations.
     * @param {pc.SpriteComponentSystem} system The ComponentSystem that created this Component
     * @param {pc.Entity} entity The Entity that this Component is attached to.
     * @property {String} type The type of the SpriteComponent. Can be one of the following:
     * <ul>
     *     <li>pc.SPRITETYPE_SIMPLE: The component renders a single frame from a sprite asset.
     *     <li>pc.SPRITETYPE_ANIMATED: The component can play sprite animation clips.
     * </ul>
     * @property {Number} frame The frame counter of the sprite. Specifies which frame from the current sprite asset to render.
     * @property {Number} spriteAsset The id of the sprite asset to render. Only works for {@link pc.SPRITETYPE_SIMPLE} types.
     * @property {pc.Sprite} sprite The current sprite.
     * @property {pc.Sprite} sprite The current sprite.
     * @property {pc.Color} color The color tint of the sprite.
     * @property {Number} opacity The opacity of the sprite.
     * @property {Boolean} flipX Flip the X axis when rendering a sprite.
     * @property {Boolean} flipY Flip the Y axis when rendering a sprite.
     * @property {Object} clips A dictionary that contains {@link pc.SpriteAnimationClip}s.
     * @property {pc.SpriteAnimationClip} currentClip The current clip being played.
     * @property {Number} speed A global speed modifier used when playing sprite animation clips.
     * @property {Number} batchGroupId Assign sprite to a specific batch group (see {@link pc.BatchGroup}). Default value is -1 (no group).
     * @property {String} autoPlayClip The name of the clip to play automatically when the component is enabled and the clip exists.
     */
    var SpriteComponent = function SpriteComponent (system, entity) {
        this._type = pc.SPRITETYPE_SIMPLE;
        this._material = system.defaultMaterial;
        this._color = new pc.Color(1,1,1,1);
        this._speed = 1;
        this._flipX = false;
        this._flipY = false;
        this._width = 1;
        this._height = 1;

        // 9-slicing
        this._outerScale = new pc.Vec2(1, 1);
        this._innerOffset = new pc.Vec4();
        this._atlasRect = new pc.Vec4();

        // batch groups
        this._batchGroupId = -1;
        this._batchGroup = null;

        // node / meshinstance
        this._node = new pc.GraphNode();
        this._model = new pc.Model();
        this._model.graph = this._node;
        this._meshInstance = null;
        entity.addChild(this._model.graph);
        this._model._entity = entity;
        this._updateAabbFunc = this._updateAabb.bind(this);

        // animated sprites
        this._autoPlayClip = null;

        this._clips = {};

        // create default clip for simple sprite type
        this._defaultClip = new pc.SpriteAnimationClip(this, {
            name: this.entity.name,
            fps: 0,
            loop: false,
            spriteAsset: null
        });

        this._currentClip = this._defaultClip;
    };
    SpriteComponent = pc.inherits(SpriteComponent, pc.Component);

    pc.extend(SpriteComponent.prototype, {
        onEnable: function () {
            SpriteComponent._super.onEnable.call(this);

            this._showModel();
            if (this._autoPlayClip)
                this._tryAutoPlay();
        },

        onDisable: function () {
            SpriteComponent._super.onDisable.call(this);

            this.stop();
            this._hideModel();
        },

        onDestroy: function () {
            this._currentClip = null;

            if (this._defaultClip) {
                this._defaultClip._destroy();
                this._defaultClip = null;
            }
            for (var key in this._clips) {
                this._clips[key]._destroy();
            }
            this._clips = null;

            this._hideModel();
            this._model = null;

            if (this._node) {
                if (this._node.parent)
                    this._node.parent.removeChild(this._node);
                this._node = null;
            }

            if (this._meshInstance) {
                this._meshInstance = null;
            }
        },

        _showModel: function () {
            // add the model to the scene
            // NOTE: only do this if the mesh instance has been created otherwise
            // the model will not be rendered when added to the scene
            if (this._model && this._meshInstance && !this.system.app.scene.containsModel(this._model)) {
                this.system.app.scene.addModel(this._model);
            }
        },

        _hideModel: function () {
            // remove model from scene
            if (this._model) {
                this.system.app.scene.removeModel(this._model);
            }
        },

        // Set the desired mesh on the mesh instance
        _showFrame: function (frame) {
            if (! this.sprite) return;

            var mesh = this.sprite.meshes[frame];
            // if mesh is null then hide the mesh instance
            if (! mesh) {
                if (this._meshInstance) {
                    this._meshInstance.mesh = null;
                    this._meshInstance.visible = false;
                }

                return;
            }

            var material = this.system.defaultMaterial;
            if (this.sprite.renderMode === pc.SPRITE_RENDERMODE_SLICED) {
                material = this.system.default9SlicedMaterialSlicedMode;
            } else if (this.sprite.renderMode === pc.SPRITE_RENDERMODE_TILED) {
                material = this.system.default9SlicedMaterialTiledMode;
            }

            // create mesh instance if it doesn't exist yet
            if (! this._meshInstance) {
                this._meshInstance = new pc.MeshInstance(this._node, mesh, this._material);
                this._meshInstance.castShadow = false;
                this._meshInstance.receiveShadow = false;
                this._model.meshInstances.push(this._meshInstance);

                // set overrides on mesh instance
                this._meshInstance.setParameter(PARAM_EMISSIVE, this._color.data3);
                this._meshInstance.setParameter(PARAM_OPACITY, this._color.data[3]);

                // now that we created the mesh instance, add the model to the scene
                if (this.enabled && this.entity.enabled) {
                    this._showModel();
                }
            }

            // update material
            if (this._meshInstance.material !== material) {
                this._meshInstance.material = material;
            }

            // update mesh
            if (this._meshInstance.mesh !== mesh) {
                this._meshInstance.mesh = mesh;
                this._meshInstance.visible = true;
                // reset aabb
                this._meshInstance._aabbVer = -1;
            }

            // set texture params
            if (this.sprite.atlas && this.sprite.atlas.texture) {
                this._meshInstance.setParameter(PARAM_EMISSIVE_MAP, this.sprite.atlas.texture);
                this._meshInstance.setParameter(PARAM_OPACITY_MAP, this.sprite.atlas.texture);
            } else {
                // no texture so reset texture params
                this._meshInstance.deleteParameter(PARAM_EMISSIVE_MAP);
                this._meshInstance.deleteParameter(PARAM_OPACITY_MAP);
            }

            // for 9-sliced
            if (this.sprite.atlas && (this.sprite.renderMode === pc.SPRITE_RENDERMODE_SLICED || this.sprite.renderMode === pc.SPRITE_RENDERMODE_TILED)) {
                // set custom aabb function
                this._meshInstance._updateAabbFunc = this._updateAabbFunc;

                this._meshInstance.nineSlice = true; // hint for shader generators

                // calculate inner offset
                var frameData = this.sprite.atlas.frames[this.sprite.frameKeys[frame]];
                if (frameData) {
                    var borderWidthScale = 2 / frameData.rect.z;
                    var borderHeightScale = 2 / frameData.rect.w;

                    this._innerOffset.set(
                        frameData.border.x * borderWidthScale,
                        frameData.border.y * borderHeightScale,
                        frameData.border.z * borderWidthScale,
                        frameData.border.w * borderHeightScale
                    );

                    var tex = this.sprite.atlas.texture;
                    this._atlasRect.set(frameData.rect.x / tex.width,
                                        frameData.rect.y / tex.height,
                                        frameData.rect.z / tex.width,
                                        frameData.rect.w / tex.height
                    );

                } else {
                    this._innerOffset.set(0,0,0,0);
                }

                // set inner offset and atlas rect on mesh instance
                this._meshInstance.setParameter(PARAM_INNER_OFFSET, this._innerOffset.data);
                this._meshInstance.setParameter(PARAM_ATLAS_RECT, this._atlasRect.data);
            } else {
                this._meshInstance._updateAabbFunc = null;
                this._meshInstance.nineSlice = false;
            }

            this._updateTransform();
        },

        _updateTransform: function () {
            // flip
            var scaleX = this.flipX ? -1 : 1;
            var scaleY = this.flipY ? -1 : 1;

            // pivot
            var posX = 0;
            var posY = 0;

            if (this.sprite && (this.sprite.renderMode === pc.SPRITE_RENDERMODE_SLICED || this.sprite.renderMode === pc.SPRITE_RENDERMODE_TILED)) {

                var w = 1;
                var h = 1;

                if (this.sprite.atlas) {
                    var frameData = this.sprite.atlas.frames[this.sprite.frameKeys[this.frame]];
                    if (frameData) {
                        // get frame dimensions
                        w = frameData.rect.z;
                        h = frameData.rect.w;

                        // update pivot
                        posX = (0.5 - frameData.pivot.x) * this._width;
                        posY = (0.5 - frameData.pivot.y) * this._height;
                    }
                }

                // scale: apply PPU
                var scaleMulX = w / this.sprite.pixelsPerUnit;
                var scaleMulY = h / this.sprite.pixelsPerUnit;

                // scale borders if necessary instead of overlapping
                this._outerScale.set(Math.max(this._width, this._innerOffset.x * scaleMulX), Math.max(this._height, this._innerOffset.y * scaleMulY));

                scaleX *= scaleMulX;
                scaleY *= scaleMulY;

                this._outerScale.x /= scaleMulX;
                this._outerScale.y /= scaleMulY;

                // scale: shrinking below 1
                scaleX *= pc.math.clamp(this._width / (this._innerOffset.x * scaleMulX), 0.0001, 1);
                scaleY *= pc.math.clamp(this._height / (this._innerOffset.y * scaleMulY), 0.0001, 1);

                // update outer scale
                if (this._meshInstance) {
                    this._meshInstance.setParameter(PARAM_OUTER_SCALE, this._outerScale.data);
                }
            }

            // scale
            this._node.setLocalScale(scaleX, scaleY, 1);
            // pivot
            this._node.setLocalPosition(posX, posY, 0);
        },

        // updates AABB while 9-slicing
        _updateAabb: function (aabb) {
            // pivot
            aabb.center.set(0,0,0);
            // size
            aabb.halfExtents.set(this._outerScale.x * 0.5, this._outerScale.y * 0.5, 0.001);
            // world transform
            aabb.setFromTransformedAabb(aabb, this._node.getWorldTransform());
            return aabb;
        },

        _tryAutoPlay: function () {
            if (! this._autoPlayClip) return;
            if (this.type !== pc.SPRITETYPE_ANIMATED) return;

            var clip = this._clips[this._autoPlayClip];
            // if the clip exists and nothing else is playing play it
            if (clip && ! clip.isPlaying && (!this._currentClip || !this._currentClip.isPlaying)) {
                if (this.enabled && this.entity.enabled) {
                    this.play(clip.name);
                }
            }
        },

        /**
         * @private
         * @function
         * @name pc.SpriteComponent#addClip
         * @description Creates and adds a new {@link pc.SpriteAnimationClip} to the component's clips.
         * @param {Object} data Data for the new animation clip.
         * @param {String} [data.name] The name of the new animation clip.
         * @param {Number} [data.fps] Frames per second for the animation clip.
         * @param {Object} [data.loop] Whether to loop the animation clip.
         * @param {Number} [data.spriteAsset] The id of the sprite asset that this clip will play.
         * @returns {pc.SpriteAnimationClip} The new clip that was added.
         */
        addClip: function (data) {
            var clip = new pc.SpriteAnimationClip(this, {
                name: data.name,
                fps: data.fps,
                loop: data.loop,
                spriteAsset: data.spriteAsset
            });

            this._clips[data.name] = clip;

            if (clip.name && clip.name === this._autoPlayClip)
                this._tryAutoPlay();

            return clip;
        },

        /**
         * @private
         * @function
         * @name pc.SpriteComponent#removeClip
         * @description Removes a clip by name.
         * @param {String} name The name of the animation clip to remove.
         */
        removeClip: function (name) {
            delete this._clips[name];
        },

        /**
         * @private
         * @function
         * @name pc.SpriteComponent#clip
         * @description Get an animation clip by name.
         * @param {String} name The name of the clip.
         * @returns {pc.SpriteAnimationClip} The clip.
         */
        clip: function (name) {
            return this._clips[name];
        },

        /**
         * @private
         * @function
         * @name pc.SpriteComponent#play
         * @description Plays a sprite animation clip by name. If the animation clip is already playing then this will do nothing.
         * @param {String} name The name of the clip to play.
         * @returns {pc.SpriteAnimationClip} The clip that started playing.
         */
        play: function (name) {
            var clip = this._clips[name];

            var current = this._currentClip;
            if (current && current !== clip) {
                current._playing = false;
            }

            this._currentClip = clip;

            if (this._currentClip) {
                this._currentClip = clip;
                this._currentClip.play();
            } else {
                logWARNING('Trying to play sprite animation ' + name + ' which does not exist.');
            }

            return clip;
        },

        /**
         * @private
         * @function
         * @name pc.SpriteComponent#pause
         * @description Pauses the current animation clip.
         */
        pause: function () {
            if (this._currentClip === this._defaultClip) return;

            if (this._currentClip.isPlaying) {
                this._currentClip.pause();
            }
        },

        /**
         * @private
         * @function
         * @name pc.SpriteComponent#resume
         * @description Resumes the current paused animation clip.
         */
        resume: function () {
            if (this._currentClip === this._defaultClip) return;

            if (this._currentClip.isPaused) {
                this._currentClip.resume();
            }
        },

        /**
         * @private
         * @function
         * @name pc.SpriteComponent#stop
         * @description Stops the current animation clip and resets it to the first frame.
         */
        stop: function () {
            if (this._currentClip === this._defaultClip) return;

            this._currentClip.stop();
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "type", {
        get: function () {
            return this._type;
        },

        set: function (value) {
            if (this._type === value)
                return;

            this._type = value;
            if (this._type === pc.SPRITETYPE_SIMPLE) {
                this.stop();
                this._currentClip = this._defaultClip;

                if (this.enabled && this.entity.enabled) {
                    this._currentClip.frame = this.frame;

                    if (this._currentClip.sprite) {
                        this._showModel();
                    } else {
                        this._hideModel();
                    }
                }

            } else if (this._type === pc.SPRITETYPE_ANIMATED) {
                this.stop();

                if (this._autoPlayClip) {
                    this._tryAutoPlay();
                }

                if (this._currentClip && this._currentClip.isPlaying && this.enabled && this.entity.enabled) {
                    this._showModel();
                } else {
                    this._hideModel();
                }
            }
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "frame", {
        get: function () {
            return this._currentClip.frame;
        },

        set: function (value) {
            this._currentClip.frame = value;
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "spriteAsset", {
        get: function () {
            return this._defaultClip._spriteAsset;
        },
        set: function (value) {
            this._defaultClip.spriteAsset = value;
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "sprite", {
        get: function () {
            return this._currentClip.sprite;
        },
        set: function (value) {
            this._currentClip.sprite = value;
        }
    });

    // (private) {pc.Material} material The material used to render a sprite.
    Object.defineProperty(SpriteComponent.prototype, "material", {
        get: function () {
            return this._material;
        },
        set: function (value) {
            this._material = value;
            if (this._meshInstance) {
                this._meshInstance.material = value;
            }
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "color", {
        get: function () {
            return this._color;
        },
        set: function (value) {
            this._color.data[0] = value.data[0];
            this._color.data[1] = value.data[1];
            this._color.data[2] = value.data[2];

            if (this._meshInstance) {
                this._meshInstance.setParameter(PARAM_EMISSIVE, this._color.data3);
            }
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "opacity", {
        get: function () {
            return this._color.data[3];
        },
        set: function (value) {
            this._color.data[3] = value;
            if (this._meshInstance) {
                this._meshInstance.setParameter(PARAM_OPACITY, value);
            }
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "clips", {
        get: function () {
            return this._clips;
        },
        set: function (value) {
            var name, key;

            // if value is null remove all clips
            if (! value) {
                for (name in this._clips) {
                    this.removeClip(name);
                }
                return;
            }

            // remove existing clips not in new value
            // and update clips in both objects
            for (name in this._clips) {
                var found = false;
                for (key in value) {
                    if (value[key].name === name) {
                        found = true;
                        this._clips[name].fps = value[key].fps;
                        this._clips[name].loop = value[key].loop;

                        if (value[key].hasOwnProperty('sprite')) {
                            this._clips[name].sprite = value[key].sprite;
                        }
                        else if (value[key].hasOwnProperty('spriteAsset')) {
                            this._clips[name].spriteAsset = value[key].spriteAsset;
                        }

                        break;
                    }
                }

                if (! found) {
                    this.removeClip(name);
                }
            }

            // add clips that do not exist
            for (key in value) {
                if (this._clips[value[key].name]) continue;

                this.addClip(value[key]);
            }

            // auto play clip
            if (this._autoPlayClip) {
                this._tryAutoPlay();
            }

            // if the current clip doesn't have a sprite then hide the model
            if (! this._currentClip || !this._currentClip.sprite) {
                this._hideModel();
            }
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "currentClip", {
        get: function () {
            return this._currentClip;
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "speed", {
        get: function () {
            return this._speed;
        },
        set: function (value) {
            this._speed = value;
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "flipX", {
        get: function () {
            return this._flipX;
        },
        set: function (value) {
            if (this._flipX === value) return;

            this._flipX = value;
            this._updateTransform();
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "flipY", {
        get: function () {
            return this._flipY;
        },
        set: function (value) {
            if (this._flipY === value) return;

            this._flipY = value;
            this._updateTransform();
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "width", {
        get: function () {
            return this._width;
        },
        set: function (value) {
            if (value === this._width) return;

            this._width = value;
            this._outerScale.x = this._width;

            if (this.sprite && (this.sprite.renderMode === pc.SPRITE_RENDERMODE_TILED || this.sprite.renderMode === pc.SPRITE_RENDERMODE_SLICED)) {
                this._updateTransform();
            }
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "height", {
        get: function () {
            return this._height;
        },
        set: function (value) {
            if (value === this._height) return;

            this._height = value;
            this._outerScale.y = this.height;

            if (this.sprite && (this.sprite.renderMode === pc.SPRITE_RENDERMODE_TILED || this.sprite.renderMode === pc.SPRITE_RENDERMODE_SLICED)) {
                this._updateTransform();
            }
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "batchGroupId", {
        get: function () {
            return this._batchGroupId;
        },
        set: function (value) {
            if (this._batchGroupId === value)
                return;

            var prev = this._batchGroupId;
            this._batchGroupId = value;

            if (prev >= 0) {
                this.system.app.batcher._markGroupDirty(prev);
            }

            if (this._batchGroupId >= 0) {
                this.system.app.batcher._markGroupDirty(this._batchGroupId);
            } else {
                // re-add model to scene in case it was removed by batching
                if (prev >= 0) {
                    if (this._currentClip && this._currentClip.sprite && this.enabled && this.entity.enabled) {
                        this._showModel();
                    }
                }
            }
        }
    });

    Object.defineProperty(SpriteComponent.prototype, "autoPlayClip", {
        get: function () {
            return this._autoPlayClip;
        },
        set: function (value) {
            this._autoPlayClip = value instanceof pc.SpriteAnimationClip ? value.name : value;
            this._tryAutoPlay();
        }
    });

    return {
        SpriteComponent: SpriteComponent
    };
}());


// Events Documentation

/**
 * @private
 * @event
 * @name pc.SpriteComponent#play
 * @description Fired when an animation clip starts playing
 * @param {pc.SpriteAnimationClip} clip The clip that started playing
 */

/**
 * @private
 * @event
 * @name pc.SpriteComponent#pause
 * @description Fired when an animation clip is paused.
 * @param {pc.SpriteAnimationClip} clip The clip that was paused
 */

/**
 * @private
 * @event
 * @name pc.SpriteComponent#resume
 * @description Fired when an animation clip is resumed.
 * @param {pc.SpriteAnimationClip} clip The clip that was resumed
 */

/**
 * @private
 * @event
 * @name pc.SpriteComponent#stop
 * @description Fired when an animation clip is stopped.
 * @param {pc.SpriteAnimationClip} clip The clip that was stopped
 */

/**
 * @private
 * @event
 * @name pc.SpriteComponent#end
 * @description Fired when an animation clip stops playing because it reached its ending.
 * @param {pc.SpriteAnimationClip} clip The clip that ended
 */

/**
 * @private
 * @event
 * @name pc.SpriteComponent#loop
 * @description Fired when an animation clip reached the end of its current loop.
 * @param {pc.SpriteAnimationClip} clip The clip
 */
