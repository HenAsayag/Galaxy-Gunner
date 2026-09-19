# Implementation Notes

## Key technical change from the previous Chicken-Invaders-style build
Do not use stationary formation grids as the dominant encounter system. Replace them with continuous timed spawners + spline paths + overlapping attack groups.

## Recommended classes
- GameScene
- PlayerController
- WeaponController
- EnemySpawner
- PathLibrary
- BulletPatternLibrary
- PickupManager
- MissileSystem
- TrailPool
- VFXPool
- DifficultyDirector
- MobileInput

## Suggested Phaser configuration
Use Phaser.AUTO with WebGL preferred by the browser, portrait base dimensions around 450x850, Scale.FIT + CENTER_BOTH, transparent=false, roundPixels=false. Keep physics simple; Arcade Physics is enough for this style.

## Collision
Use small circular or rectangular hitboxes. Do not use visual sprite bounds as hitboxes. Bullet-hell games feel fair only when the player hitbox is considerably smaller than the rendered craft.
