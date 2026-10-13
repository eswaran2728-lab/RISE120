-- Exercise library for the 120-day plan: five movement patterns (squat, hinge, push, pull, core)
-- for each equipment group. muscle_group holds the movement pattern.
-- NOTE: instructions are starter text and need owner/trainer review before public launch.
insert into public.exercises (name, muscle_group, equipment, instructions)
select v.name, v.muscle_group, v.equipment, v.instructions
from (values
  ('Goblet squat', 'squat', 'gym', 'Hold one dumbbell upright against your chest. Feet shoulder-width apart. Sit your hips down and back, keep your chest up and heels on the floor, then stand up. Move slowly and stop if you feel pain.'),
  ('Dumbbell Romanian deadlift', 'hinge', 'gym', 'Hold a dumbbell in each hand in front of your thighs. Keep knees slightly bent and push your hips back while the dumbbells slide down your legs. Keep your back straight, then squeeze your hips forward to stand.'),
  ('Chest press machine', 'push', 'gym', 'Sit with your back flat against the pad and the handles at chest height. Press the handles forward until your arms are almost straight, then return slowly. Do not lock your elbows.'),
  ('Seated cable row', 'pull', 'gym', 'Sit tall with your feet braced and knees slightly bent. Pull the handle to your lower ribs, squeezing your shoulder blades together, then let your arms extend slowly. Keep your back straight.'),
  ('Plank', 'core', 'gym', 'Rest on your forearms and toes with your body in a straight line from head to heels. Tighten your stomach and hips and breathe steadily. Hold for the time shown, or stop when your form slips.'),

  ('Chair squat', 'squat', 'home', 'Stand in front of a sturdy chair with feet shoulder-width apart. Sit your hips back until you lightly touch the chair, then stand up. Keep your chest up and knees in line with your toes.'),
  ('Unloaded hip hinge', 'hinge', 'home', 'Stand with feet hip-width apart and hands on your hips. Keep your knees slightly bent and push your hips back with a straight back until you feel your hamstrings stretch, then return to standing.'),
  ('Countertop incline push-up', 'push', 'home', 'Place your hands on a stable countertop a little wider than your shoulders. Keep your body in a straight line, lower your chest toward the counter, then push back up.'),
  ('Prone W raise', 'pull', 'home', 'Lie face down with your arms bent in a W shape. Lift your elbows and chest slightly while squeezing your shoulder blades together, hold briefly, then lower slowly. Keep your neck relaxed.'),
  ('Dead bug', 'core', 'home', 'Lie on your back with arms up and knees bent over your hips. Slowly lower one arm and the opposite leg toward the floor while keeping your lower back flat, then return and switch sides.'),

  ('Bodyweight squat', 'squat', 'none', 'Stand with feet shoulder-width apart. Sit your hips down and back, keep your chest up and heels on the floor, then stand up. Move slowly and stop if you feel pain.'),
  ('Glute bridge', 'hinge', 'none', 'Lie on your back with knees bent and feet flat on the floor. Push through your heels to lift your hips until your body is in a straight line from shoulders to knees, squeeze, then lower slowly.'),
  ('Wall push-up', 'push', 'none', 'Stand facing a wall and place your hands on it at chest height, a little wider than your shoulders. Bend your elbows to bring your chest toward the wall, then push back to the start.'),
  ('Prone W raise', 'pull', 'none', 'Lie face down with your arms bent in a W shape. Lift your elbows and chest slightly while squeezing your shoulder blades together, hold briefly, then lower slowly. Keep your neck relaxed.'),
  ('Dead bug', 'core', 'none', 'Lie on your back with arms up and knees bent over your hips. Slowly lower one arm and the opposite leg toward the floor while keeping your lower back flat, then return and switch sides.')
) as v(name, muscle_group, equipment, instructions)
where not exists (
  select 1 from public.exercises e where e.name = v.name and e.equipment = v.equipment
);
