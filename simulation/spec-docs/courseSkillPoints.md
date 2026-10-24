# Course Skill Points

Simulated year of the MEEC, CRAI and Energy areas. Filipe Oliveira, October 2026.

20 courses, 97 badges, 1200 skill points. `courses.json` holds the content of this file.

## Rules

1. A course of 6 ECTS credits carries 60 skill points, 10 per credit.
2. Each graded assessment of the grading formula defines one badge, which carries 60 times the weight of the assessment (Equation 3.1), in whole points. The Share column gives the points of the badge over the 60 of the course, so a weight rounded to whole points shows its rounded value.
3. Where only the weight of a component is published, its points are split evenly across its assessments, in whole points. Leftover points go to the assessment with more weeks of work, or to the earlier one. A share that rests on an assumption about the grading formula is marked *, and the course states the assumption under Assumed split.
4. Where a course offers alternative formulas, the first is used (OA). Where the grade is the better of two complete paths, every assessment of both mints a badge and the 60 points split evenly (PCEEle). A best-of-N rule counts N equal assessments (PCEEle, EMEne, ERPD).
5. Small assessments of equal weight on related content form one badge (EEner LAB 1 and 2, ADRI MAP 1 and 2, ARed TEST 1 to 3). Assessments under a best-of-N rule are not grouped, since a student may skip any one of them (EMEne, ERPD).
6. A badge splits its points over one to four skill types (MAX_SKILLS_PER_BADGE of the badge contract), in whole points, by the share of the assessment's content in each type.
7. Every skill type appears in at least two courses.
8. A badge is minted for an assessment graded 10 out of 20 or above, whether or not the student passes the course. Grades are whole numbers from 0 to 20, rounded half up, so 9.5 counts as 10.
9. In a group assessment, every member receives the badge with its full points.
10. Weeks are weeks of the simulated year. Here a course publishes the weeks of all its assessments other than the exam, or of none. A published week is counted from the first week of the period, and a week past the period moves to its last week. Weeks counted from the start of the semester are not used (AVE). Exams are in the last week of the period. In a course without published weeks, the k-th of its n other assessments goes to week 1 + (L - 1)k/n of the period, rounded half up, where L is 6, or 7 if the course has no exam badge. Weeks set by these rules are marked ~.

## Skill types

| Code | Skill type |
|---|---|
| CODE | Code implementation |
| DATA | Data wrangling, statistics and visualization |
| ML | Supervised and unsupervised learning, model evaluation |
| DL | Neural architectures, backpropagation, CNNs and RNNs |
| OPT | Convex optimization, algorithms and gradient methods |
| CTR | Feedback systems, state space, stability and automation |
| SIG | Fourier and Z-transforms, filtering and estimation |
| PWR | Power electronics, electrical machines and power generation |
| GRID | Network topology, power flow, protection and state estimation |
| REN | Wind, solar PV, storage and batteries |
| THERMO | Thermal cycles, steam and gas properties, heat transfer |
| SIM | Numerical modeling and simulation |
| MATH | Linear algebra, probability and calculus |

## AAut, Aprendizagem Automatica

Season 1, P1, weeks 1 to 7, CRAI, 6 ECTS. Grading formula of 2025/26.

https://fenix.tecnico.ulisboa.pt/disciplinas/AAut112/2025-2026/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| Lab component, 2 projects with 4 deliverables and a final report | 50% | 8.0 |
| Written exam | 50% | 8.0 |
| Final grade | 50% lab + 50% exam | 9.5 |

Assumed split: the 50% of the lab component is split evenly across its five deliverables, 10% each (6 points). Its sub-weights are not published.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Regression I | Project 1, deliverable 1 | ~2 | 6 | 10%* | CODE: 1, MATH: 1, DATA: 2, ML: 2 | Linear regression on synthetic data, NumPy matrix implementation, SSE cost. |
| 2 | Regression II | Project 1, deliverable 2 | ~3 | 6 | 10%* | CODE: 1, MATH: 1, DATA: 2, ML: 2 | Robust regression, outlier detection, robust estimation design. |
| 3 | Classification I | Project 2, deliverable 1 | ~4 | 6 | 10%* | CODE: 1, DATA: 2, ML: 2, DL: 1 | Binary image classification, imbalanced datasets, CNN application. |
| 4 | Classification II | Project 2, deliverable 2 | ~5 | 6 | 10%* | CODE: 1, DATA: 2, ML: 2, DL: 1 | Multiclass pixel segmentation, spatial feature engineering, multiclass network design. |
| 5 | Report Synthesis | Final report | ~6 | 6 | 10%* | CODE: 1, DATA: 2, ML: 2, DL: 1 | 10-page methodological synthesis, data visualization, statistical evaluation. |
| 6 | Theorist | Written exam | ~7 | 30 | 50% | MATH: 12, OPT: 6, ML: 6, DL: 6 | Full syllabus theory: SVMs, Bayes classifiers, decision trees, neural networks, optimization. |

Total: CODE: 5, DATA: 10, ML: 16, DL: 9, OPT: 6, MATH: 14. Sum 60.

## OA, Optimizacao e Algoritmos

Season 1, P1, weeks 1 to 7, CRAI, 6 ECTS. Grading formula of 2025/26.

https://fenix.tecnico.ulisboa.pt/disciplinas/OA222/2025-2026/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| Group project, 2 parts with 10 tasks | 25% | 9.5 |
| Quiz MAP45, closed book, 45 min | 25% | 0 |
| Final exam, closed book, 1h45 | 50% | 8.0 |
| Final grade | best of 25% P + 25% MAP + 50% EX, 25% P + 75% EX, or 25% P + 75% EX2 |  |

Assumed split: the first formula is used, 25% P + 25% MAP + 50% EX. The 25% of the project is split evenly across its two parts, 7.5 points each. The leftover point goes to Part 1, the earlier of two parts with equal work.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Robust Classifier | Project, part 1 | ~3 | 8 | 13.3%* | OPT: 3, MATH: 2, ML: 2, SIM: 1 | Adversarial-robust classification (MNIST), convexity proofs, CVX numerical implementation. |
| 2 | Signal Fitting | Project, part 2 | ~4 | 7 | 11.7%* | OPT: 2, MATH: 2, ML: 1, SIM: 2 | Piecewise-linear signal fitting, Levenberg-Marquardt implementation, analytical Jacobian. |
| 3 | Quiz | Quiz MAP45 | ~6 | 15 | 25% | OPT: 6, MATH: 6, ML: 3 | Unconstrained optimization, asymmetric penalties, hand-computed LM iterates. |
| 4 | Theorist | Final exam | ~7 | 30 | 50% | OPT: 13, MATH: 10, CTR: 7 | KKT conditions, strong convexity proofs, dynamical systems, energy disaggregation. |

Total: ML: 6, OPT: 24, CTR: 7, SIM: 3, MATH: 20. Sum 60.

## CSCib, Controlo de Sistemas Ciberfisicos

Season 1, P1, weeks 1 to 7, CRAI, 6 ECTS. Grading formula of 2024/25, assessment material of 2023/24 and 2024/25.

https://fenix.tecnico.ulisboa.pt/disciplinas/CSCib11/2024-2025/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| Laboratory, 2 parts in groups, individual grades | 50% |  |
| Exam, 2 sittings, the better grade counts | 50% | 8 |
| Final grade | 0.5 E + 0.5 L | 9.5 |

Assumed split: the 50% of the laboratory is split evenly across its two reports, 25% each (15 points).

The exam has two sittings and the better grade counts, so it is one assessment.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Plant Identification | Lab report, part I | ~4 | 15 | 25%* | CTR: 4, DATA: 4, SIG: 4, SIM: 3 | Identification of a flexible robot-arm joint: sensor calibration, excitation-signal design, sampling-frequency and data-filtering analysis, model-order selection, ARMAX and state-space models with pole-zero and frequency-response characterization, in Matlab. |
| 2 | LQG Control | Lab report, part II | ~6 | 15 | 25%* | CTR: 6, SIM: 3, CODE: 3, DATA: 3 | Computer control of the identified plant: LQR weight selection, Kalman observer (LQE) and LTR tuning, closed-loop frequency and time response, experimental performance evaluation on the physical plant, designed in Simulink and Matlab. |
| 3 | Theorist | Exam | ~7 | 30 | 50% | CTR: 11, MATH: 10, SIG: 6, DATA: 3 | Difference equations and Z-transforms, state-space representations, ZOH discretization, controllability/observability under sampling, stochastic systems with process and measurement noise, estimation and stochastic control. |

Total: CODE: 3, DATA: 10, CTR: 21, SIG: 10, SIM: 6, MATH: 10. Sum 60.

## PCEEle, Producao e Consumo de Energia Electrica

Season 1, P1, weeks 1 to 7, Energy, 6 ECTS. Grading formula of 2025/26.

https://fenix.tecnico.ulisboa.pt/disciplinas/PCEEle112/2025-2026/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| Continuous evaluation, 4 tests, best 3 | 100% if higher |  |
| Final exam | 100% if higher | 8.5 |
| Final grade | the better of the average of the best 3 tests and the exam | 8.5 |

Assumed split: the grade is the better of two complete paths, so no assessment has a weight of its own. Every assessment of both paths mints a badge, and the 60 points split evenly across the five, 12 each. Best 3 of 4 counts as four equal tests.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Thermodynamics | MAP1 | ~2 | 12 | 20%* | THERMO: 7, PWR: 2, MATH: 3 | Steam tables, two-phase mixtures, thermodynamic processes, interpolation calculations. |
| 2 | Rankine Cycle | MAP2 | ~4 | 12 | 20%* | THERMO: 4, PWR: 3, OPT: 3, MATH: 2 | Rankine cycle optimization, thermal efficiency, steam mass flow balancing. |
| 3 | Turbines and Brayton | MAP3 | ~5 | 12 | 20%* | PWR: 5, THERMO: 3, OPT: 2, MATH: 2 | Impulse/reaction turbines, Brayton cycle, velocity triangles, multi-stage compression. |
| 4 | Hydroelectric | MAP4 | ~6 | 12 | 20%* | REN: 6, PWR: 5, MATH: 1 | Turbine selection (Pelton, Francis, Kaplan), specific speed, head loss, group sizing. |
| 5 | Theorist | Final exam | ~7 | 12 | 20%* | THERMO: 3, REN: 3, GRID: 3, DATA: 3 | Energy fundamentals, load diagrams and renewable sizing, over the full syllabus. |

Total: DATA: 3, OPT: 5, PWR: 15, GRID: 3, REN: 9, THERMO: 17, MATH: 8. Sum 60.

## EEner, Electronica de Potencia para Energia

Season 1, P1, weeks 1 to 7, Energy, 6 ECTS. Grading formula of 2024/25.

https://fenix.tecnico.ulisboa.pt/disciplinas/EEner11/2024-2025/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| MAP45, 45 min electronic test | 40% | 6.5 |
| Exam45, the second test, or Exam90 | 30% | 6.5 |
| Laboratory, Labs 2 to 5 | 30% | 6.5 |
| Final grade | 0.4 MAP45 + 0.3 L + 0.3 Exam45 | 9.5 |

Assumed split: the 30% of the laboratory is split evenly across the two lab badges, 15% each (9 points).

LAB 1 groups Labs 2 and 3, and LAB 2 groups Labs 4 and 5. The introductory lab is not graded and mints no badge.

Exam90, an alternative to Exam45, is left out and mints no badge.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Rectifier Labs | LAB 1 | ~3 | 9 | 15%* | PWR: 4, CTR: 2, SIG: 2, DATA: 1 | Single-phase half-wave thyristor rectifier with firing circuit, three-phase half- and full-wave line-commutated rectifiers on RLE loads, transformer current registration, firing-angle control, waveform capture. |
| 2 | Converter Labs | LAB 2 | ~4 | 9 | 15%* | PWR: 4, CTR: 3, SIG: 1, DATA: 1 | Three-phase inverter with SPWM, two- and three-level four-quadrant IGBT chopper with PWM drive, load-current waveform analysis on inductive loads. |
| 3 | Rectifier Analyst | MAP45 | ~6 | 24 | 40% | PWR: 9, MATH: 7, GRID: 4, SIG: 4 | Diode and thyristor rectifier analysis: pulse index, average/RMS currents, reverse voltage, input AC quantities, front-end transformers, series/parallel associations and HVDC, rectifier control. |
| 4 | Converter Theorist | Exam45, second test | ~7 | 18 | 30% | PWR: 7, CTR: 4, MATH: 4, REN: 3 | DC-DC buck/boost in CCM/DCM, 2Q/4Q choppers, single- and three-phase inverters, SPWM, unity-power-factor rectifier, converter sizing for renewable applications. |

Total: DATA: 2, CTR: 9, SIG: 7, PWR: 24, GRID: 4, REN: 3, MATH: 11. Sum 60.

## MEle, Maquinas Electricas

Season 1, P1, weeks 1 to 7, Energy, 6 ECTS. Grading formula of 2024/25.

https://fenix.tecnico.ulisboa.pt/disciplinas/MEle11/2024-2025/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| Laboratory, 4 group assignments, report due the week after each lab | 50% | 9.5 |
| Final exam, 1h59 | 50% | 8.0 |
| Final grade | 0.5 exam + 0.5 laboratory | 9.5 |

Assumed split: the 50% of the laboratory is split evenly across its four reports, 7.5 points each. The two leftover points go to the two-part assignments T1 and T3.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Efficiency and Thermal Lab | T1 report, parts A and B | ~2 | 8 | 13.3%* | THERMO: 3, PWR: 3, DATA: 2 | Iron/copper losses as heat, internal temperature rise, insulation classes and thermal margins, temperature-dependent winding resistance, airgap effects. |
| 2 | DC Machine Lab | T2 report | ~4 | 7 | 11.7%* | PWR: 3, THERMO: 2, DATA: 2 | Motor-generator group testing: no-load loss segregation, loss-to-heat power balance, efficiency versus mechanical power. |
| 3 | Induction Machine Lab | T3 report, parts A and B | ~5 | 8 | 13.3%* | PWR: 3, CTR: 2, GRID: 2, DATA: 1 | Three-phase induction machine under scalar V/f command, generator operation grid-connected and isolated, load registration across regimes. |
| 4 | Synchronous Motor Lab | T4 report | ~6 | 7 | 11.7%* | PWR: 4, DATA: 3 | Asynchronous starting of the synchronous motor, stator-resistance measurement, speed transients, torque-speed characteristic. |
| 5 | Theorist | Final exam | ~7 | 30 | 50% | PWR: 15, MATH: 11, GRID: 4 | Magnetic-circuit and transformer analysis, equivalent circuits, torque and efficiency at operating points, iron-loss decomposition, induction and synchronous machine steady-state. |

Total: DATA: 8, CTR: 2, PWR: 28, GRID: 6, THERMO: 5, MATH: 11. Sum 60.

## AProf, Aprendizagem Profunda

Season 1, P2, weeks 8 to 14, CRAI, 6 ECTS. Grading formula of 2025/26.

https://fenix.tecnico.ulisboa.pt/disciplinas/AProf112/2025-2026/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| Homeworks, average of HW1 and HW2, groups of 3 | 50% | 8.0 each |
| Final exam, open book, 120 min | 50% | 8.0 |
| Final grade | 50% HW + 50% exam | 9.5 |

The homework average gives each homework 25%.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Foundations | Homework 1 | ~11 | 15 | 25% | CODE: 3, ML: 4, DL: 5, MATH: 3 | MLP from scratch in NumPy, manual backpropagation, PyTorch reimplementation, linear algebra proofs. |
| 2 | Architectures | Homework 2 | ~13 | 15 | 25% | CODE: 3, DL: 6, DATA: 3, MATH: 3 | CNNs, bidirectional LSTMs with attention, seq2seq translation, convolution matrix proofs. |
| 3 | Theorist | Final exam | ~14 | 30 | 50% | MATH: 8, DL: 11, ML: 6, OPT: 5 | RNN hidden state computation, CNN forward passes, optimization derivations, Transformers, GANs, VAEs. |

Total: CODE: 6, DATA: 3, ML: 10, DL: 22, OPT: 5, MATH: 14. Sum 60.

## PIV, Processamento de Imagem e Visao

Season 1, P2, weeks 8 to 14, CRAI, 6 ECTS. Grading formula of 2025/26.

https://fenix.tecnico.ulisboa.pt/disciplinas/PIV/2025-2026/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| Final exam | 50% | 8.0 |
| Continuous evaluation, project and labwork | 50% | 9.5 |
| Final grade | 50% exam + 50% continuous | 9.5 |

Assumed split: the 50% of the continuous evaluation is split evenly across its three assessments, 16.7% each (10 points).

Project parts I and II are submitted together at the end of classes and graded once.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | 3D Reconstruction | Labwork 1 | ~10 | 10 | 16.7%* | CODE: 4, MATH: 3, SIM: 1, DATA: 2 | 3D point cloud from depth, camera matrix computation, SIFT matching, relative pose estimation. |
| 2 | Calibration | Labwork 2 | ~11 | 10 | 16.7%* | CODE: 3, MATH: 3, SIM: 3, DATA: 1 | Camera calibration, homography computation from image sequences, RANSAC outlier removal. |
| 3 | Vision Project | Project parts I and II, with oral | ~13 | 10 | 16.7%* | CODE: 3, MATH: 3, SIM: 2, DATA: 2 | Homography pipeline with RANSAC, RGB-D registration via Procrustes, plane fitting, segmentation. |
| 4 | Theorist | Final exam | ~14 | 30 | 50% | MATH: 11, DL: 8, OPT: 6, CODE: 5 | Stereo geometry, fundamental matrices, Rodrigues rotation, CNN architectures, optical flow. |

Total: CODE: 15, DATA: 5, DL: 8, OPT: 6, SIM: 6, MATH: 20. Sum 60.

## Rob, Robotica

Season 1, P2, weeks 8 to 14, CRAI, 6 ECTS. Grading formula of 2025/26.

https://fenix.tecnico.ulisboa.pt/disciplinas/Rob112/2025-2026/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| Laboratory 1, report and software, groups of up to 4 | 35% |  |
| Laboratory 2, report and software, groups of up to 4 | 35% |  |
| Project paper, up to 6 pages, 2 to 4 authors | 30% |  |
| Final grade | 0.3 paper + 0.7 (Lab 1 + Lab 2)/2 | 9.5 |

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Lane Assist Simulation | Laboratory 1 | ~10 | 21 | 35% | SIM: 6, CTR: 6, CODE: 5, MATH: 4 | Simulated Lane Tracking Assist system: kinematic car model, onboard-sensor models, road-lane simulation environment, line-detection quality, LTA controller design and integration. |
| 2 | Gesture-Driven Actuator | Laboratory 2 | ~12 | 21 | 35% | CODE: 7, SIG: 6, CTR: 4, DATA: 4 | Human-augmentation device on Arduino: 9-DOF IMU signal processing for gesture recognition, stepper actuation via pulse timing, sensor-to-actuator architecture. |
| 3 | Robotics Paper | Project paper | ~14 | 18 | 30% | CTR: 5, MATH: 5, DATA: 4, SIG: 4 | Scientific-format paper on a robotics topic spanning kinematics, dynamics, control, sensing and fusion. |

Total: CODE: 12, DATA: 8, CTR: 15, SIG: 10, SIM: 6, MATH: 9. Sum 60.

## ARed, Analise de Redes

Season 1, P2, weeks 8 to 14, Energy, 6 ECTS. Grading formula of 2025/26, assessment material of 2022/23.

https://fenix.tecnico.ulisboa.pt/disciplinas/ARed112/2025-2026/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| Lab tests, average of 3 tests of about 30 min | 50% | 9.5 |
| Written exam, 2h, open book | 50% | 8.0 |
| Final grade | 50% lab + 50% exam |  |

Assumed split: the three MAP tests are not in the published formula. They are taken as part of the 50% continuous component, and each lab test is paired with the MAP test of the same cycle, 16.7% each (10 points).

Each TEST groups a lab test with the MAP test of its cycle. Under the limit of four types per badge, TEST 2 leaves out CTR and PWR, and TEST 3 leaves out SIG and OPT.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Power Flow | TEST 1, lab test 1 and MAP test 1 | ~10 | 10 | 16.7%* | GRID: 3, MATH: 3, PWR: 2, SIM: 2 | MATLAB power flow, pi-model, Y-matrix construction, Gauss-Jacobi solver, power flow fundamentals, Gauss recurrence derivation, network component classification. |
| 2 | Newton and Fault Theory | TEST 2, lab test 2 and MAP test 2 | ~11 | 10 | 16.7%* | GRID: 4, SIM: 2, MATH: 2, SIG: 2 | Multi-bus Newton-Raphson, Jacobian construction, fast decoupled methods, symmetrical components (Fortescue), generator sequence impedance evaluation. |
| 3 | Faults and State Estimation | TEST 3, lab test 3 and MAP test 3 | ~13 | 10 | 16.7%* | GRID: 4, MATH: 2, SIM: 2, DATA: 2 | MATLAB short-circuit simulation, Thevenin equivalents, asymmetric fault analysis, network state estimation, linear measurement models, weighted least-squares. |
| 4 | Theorist | Final exam | ~14 | 30 | 50% | GRID: 12, MATH: 8, SIG: 6, DATA: 4 | Network analysis over power flow, faults and state estimation. |

Total: DATA: 6, SIG: 8, PWR: 2, GRID: 23, SIM: 6, MATH: 15. Sum 60.

## AVE, Acionamentos e Veiculos Electricos

Season 1, P2, weeks 8 to 14, Energy, 6 ECTS. Grading formula of 2022/23, assessment material of 2023/24.

https://fenix.tecnico.ulisboa.pt/disciplinas/AVE/2022-2023/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| Final exam, 1h59 | 50% | 8.0 |
| Laboratory, continuous, 4 labs and the VIENA project | 50% | 9.5 |
| Final grade | 0.5 exam + 0.5 lab | 9.5 |

Assumed split: the 50% of the laboratory is split evenly across its four reports, 7.5 points each. The two leftover points go to the two VIENA simulation reports.

Lab 1, an introduction, and Lab 4, a demonstration, have no report and no grade, so they mint no badge.

The reports are due in weeks 4, 4, 6 and 8 of the semester, not of the period, so their weeks below are assumed.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Powertrain Model | Report VIENA 1 and 2 | ~9 | 8 | 13.3%* | SIM: 3, MATH: 2, PWR: 2, CTR: 1 | Simulink vehicle dynamics subsystem, track characterization, equivalent rotational mass, induction motor equivalent circuit, V/f torque-speed curves. |
| 2 | Scalar Drive Lab | Report LAB2 | ~11 | 7 | 11.7%* | PWR: 3, CTR: 2, SIG: 1, DATA: 1 | Inverter configuration, startup transients, harmonic analysis of stator current and voltage, steady-state measurements at 30/50/70 Hz. |
| 3 | Synchronous Machine Lab | Report LAB3 | ~12 | 7 | 11.7%* | PWR: 4, CTR: 2, DATA: 1 | Asynchronous and auxiliary startup methods, excitation current sweep for reactive power control, torque-speed characteristics under variable load. |
| 4 | Vector Control Design | Report VIENA 3 | ~13 | 8 | 13.3%* | CTR: 3, SIM: 2, MATH: 2, PWR: 1 | Park dq dynamic model, synchronous reference frame, FOC implementation with flux observer, PI gain tuning against V/f baseline. |
| 5 | Theorist | Final exam | ~14 | 30 | 50% | MATH: 9, PWR: 9, CTR: 7, REN: 5 | Field-weakening flux estimation, slip and torque-speed computation, FOC current/voltage calculation, dq model manipulation, battery pack pre-design, vehicle traction energy. |

Total: DATA: 2, CTR: 15, SIG: 1, PWR: 19, REN: 5, SIM: 5, MATH: 13. Sum 60.

## EMEne, Economia e Mercados de Energia

Season 1, P2, weeks 8 to 14, Energy, 6 ECTS. Grading formula of 2024/25, assessment material of 2024/25 and exam keys of 2016 to 2020.

https://fenix.tecnico.ulisboa.pt/disciplinas/EMEne411/2024-2025/1-semestre

| Component | Weight | Minimum |
|---|---|---|
| 6 weekly multiple-choice quizzes, from week 2 | 50%, best 5 of 6 |  |
| 6 weekly problems, from week 3 | 50%, best 5 of 6 |  |

Assumed split: best 5 of 6 counts as six equal assessments per component, 12 in total, 8.3% each (5 points).

Economics content is mapped to MATH, since no skill type covers economics.

A final exam is a second chance for students who fail the continuous assessment. It is left out and mints no badge.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Quiz 1 | Weekly quiz | 9 | 5 | 8.3%* | MATH: 5 | Theory of producers. |
| 2 | Problem 1 | Weekly problem | 10 | 5 | 8.3%* | MATH: 3, OPT: 2 | Cobb-Douglas production, cost minimization. |
| 3 | Quiz 2 | Weekly quiz | 10 | 5 | 8.3%* | MATH: 5 | Theory of consumers. |
| 4 | Problem 2 | Weekly problem | 11 | 5 | 8.3%* | MATH: 5 | Utility and demand functions. |
| 5 | Quiz 3 | Weekly quiz | 11 | 5 | 8.3%* | MATH: 5 | Single-market behavior. |
| 6 | Problem 3 | Weekly problem | 12 | 5 | 8.3%* | MATH: 5 | Equilibrium, elasticity, welfare. |
| 7 | Quiz 4 | Weekly quiz | 12 | 5 | 8.3%* | MATH: 5 | Market types. |
| 8 | Problem 4 | Weekly problem | 13 | 5 | 8.3%* | MATH: 3, OPT: 2 | Monopoly and oligopoly profit maximization. |
| 9 | Quiz 5 | Weekly quiz | 13 | 5 | 8.3%* | MATH: 2, PWR: 2, GRID: 1 | Costs in power systems. |
| 10 | Problem 5 | Weekly problem | 14 | 5 | 8.3%* | MATH: 4, PWR: 1 | Power-system cost analysis. |
| 11 | Quiz 6 | Weekly quiz | 14 | 5 | 8.3%* | MATH: 3, GRID: 2 | Regulation and electricity markets. |
| 12 | Problem 6 | Weekly problem | ~14 | 5 | 8.3%* | MATH: 3, GRID: 2 | Tariffs and market clearing. |

Total: OPT: 4, PWR: 3, GRID: 5, MATH: 48. Sum 60.

## PDS, Processamento Digital de Sinais

Season 2, P3, weeks 16 to 22, CRAI, 6 ECTS. Grading formula of 2024/25.

https://fenix.tecnico.ulisboa.pt/disciplinas/PDS36/2024-2025/2-semestre

| Component | Weight | Minimum |
|---|---|---|
| Lab component, lab assignments in weeks 2 and 3, project with report in weeks 4 to 7 | 50% | 8.0 |
| Exam, 2h | 50% | 8.0 |
| Final grade | 50% lab + 50% exam | 9.5 |

Assumed split: the 50% of the lab component is split evenly across its three assessments, 16.7% each (10 points).

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Signal Fundamentals | Lab 1, code submission | 17 | 10 | 16.7%* | SIG: 4, CODE: 3, MATH: 2, DATA: 1 | Chirp sampling, spectrogram computation, downsampling/aliasing, anti-aliasing FIR filter design, audio data with sampling metadata. |
| 2 | Spectral Analysis | Lab 2, code submission | 18 | 10 | 16.7%* | SIG: 4, CODE: 2, MATH: 2, DATA: 2 | DFT magnitude/phase spectra, reconstruction from spectral peaks, voice signal FFT analysis, zero-padding effects. |
| 3 | Anomaly Detection | Project, code and 5-page report | 22 | 10 | 16.7%* | SIG: 3, CODE: 3, DATA: 2, REN: 2 | AR model design for residential solar PV time series, least squares estimation, spectrogram-based anomaly detection on real PV production data, custom Python implementations. |
| 4 | Theorist | Exam | ~22 | 30 | 50% | MATH: 11, SIG: 11, DATA: 8 | LTI analysis, frequency response, Z-transform ROC, stability/causality, circular convolution, DFT and FFT, least squares, MLE, Cramer-Rao bound. |

Total: CODE: 8, DATA: 13, SIG: 22, REN: 2, MATH: 15. Sum 60.

## SCDTR, Sistemas de Controlo Distribuido em Tempo Real

Season 2, P3, weeks 16 to 22, CRAI, 6 ECTS. Grading formula of 2025/26.

https://fenix.tecnico.ulisboa.pt/disciplinas/SCDTR3610/2025-2026/2-semestre

| Component | Weight | Minimum |
|---|---|---|
| Project, average of Stage 1 and Stage 2 | 60% | 8 |
| Stage 1, individual, weeks 1 to 3 | 30% of the grade |  |
| Stage 2, group of 3, weeks 4 to 6 | 30% of the grade |  |
| Exam, week 9, waived if the project grade is 13 or more, the project then counting 100% | 40% |  |
| Final grade | 0.6 P + 0.4 E | 9.5 |

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Luminaire Node | Stage 1, individual | 18 | 18 | 30% | CODE: 7, CTR: 6, SIM: 3, DATA: 2 | Smart-luminaire node on RPi Pico: LED-driver and LDR circuits, identification of the LED-LDR plant with simulation-based validation, local PID with anti-windup, ADC acquisition, serial interface. |
| 2 | Distributed Controller | Stage 2, group report and demo | 21 | 18 | 30% | OPT: 6, CODE: 5, CTR: 5, DATA: 2 | Cooperative control on the CAN-BUS network: consensus and dual-decomposition energy minimization under comfort constraints, synchronization protocols, performance benchmarking. |
| 3 | Theorist | Exam | ~22 | 24 | 40% | CODE: 7, CTR: 7, OPT: 5, MATH: 5 | Multicore C++ program analysis, PI discretization with sampling and saturation design, coupling-matrix energy optimization, decentralized coordinated control. |

Total: CODE: 19, DATA: 4, OPT: 11, CTR: 18, SIM: 3, MATH: 5. Sum 60.

## ADRI, Analitica de Dados para Redes Inteligentes

Season 2, P3, weeks 16 to 22, Energy, 6 ECTS. Grading formula of 2025/26, assessment material of 2024/25.

https://fenix.tecnico.ulisboa.pt/disciplinas/ADRI3610/2025-2026/2-semestre

| Component | Weight | Minimum |
|---|---|---|
| 2 projects with final presentations | 25% each | 9.5 each |
| 6 written problem reports | 50% |  |
| Final grade | 25% project 1 + 25% project 2 + 50% reports |  |

Assumed split: the 50% of the problem reports is split evenly across the two MAP badges, 25% each (15 points).

MAP 1 groups problem reports 1 to 3, and MAP 2 groups reports 4 to 6. The content of each report is assumed from the order of the syllabus.

An oral exam for grades above 17 is not a graded assessment and mints no badge.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Grid Analytics | MAP 1, problem reports 1 to 3 | ~18 | 15 | 25%* | GRID: 5, DATA: 4, MATH: 3, CODE: 3 | Consumption data analysis for phase identification, network loss modeling, state estimation on grid measurements, Jupyter implementations with real grid data. |
| 2 | Statistical Methods | MAP 2, problem reports 4 to 6 | ~19 | 15 | 25%* | DATA: 5, MATH: 4, ML: 3, CODE: 3 | AR/time series modeling, Markov chains, dimensionality reduction, regularized regression applied to grid contexts. |
| 3 | Project 1 | Project 1, presentation | ~21 | 15 | 25% | GRID: 5, DATA: 4, CODE: 4, ML: 2 | Applied grid analytics project (asset management or outage forecasting context assumed), group presentation with implementation. |
| 4 | Project 2 | Project 2, presentation | ~22 | 15 | 25% | GRID: 5, DATA: 4, CODE: 3, MATH: 3 | Applied grid analytics project (operational optimization or situational awareness context assumed), group presentation with implementation. |

Total: CODE: 13, DATA: 17, ML: 5, GRID: 15, MATH: 10. Sum 60.

## ERPD, Energias Renovaveis e Producao Descentralizada

Season 2, P3, weeks 16 to 22, Energy, 6 ECTS. Grading formula of 2024/25, assessment material from the 2018 exam and tests.

https://fenix.tecnico.ulisboa.pt/disciplinas/ERPD236/2024-2025/2-semestre

| Component | Weight | Minimum |
|---|---|---|
| 6 weekly multiple-choice quizzes, from week 2 | 50%, best 5 of 6 |  |
| 6 weekly problems, from week 2 | 50%, best 5 of 6 |  |
| Final exam, alternative to the continuous assessment | 100% |  |

Assumed split: best 5 of 6 counts as six equal assessments per component, 12 in total, 8.3% each (5 points).

The topic of each week is assumed from the order of the syllabus.

The alternative final exam is left out and mints no badge.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Quiz 1 | Weekly quiz | 17 | 5 | 8.3%* | REN: 2, GRID: 2, PWR: 1 | Portuguese power system. |
| 2 | Problem 1 | Weekly problem | 17 | 5 | 8.3%* | GRID: 3, MATH: 2 | Power system context. |
| 3 | Quiz 2 | Weekly quiz | 18 | 5 | 8.3%* | REN: 3, MATH: 2 | Energy economics. |
| 4 | Problem 2 | Weekly problem | 18 | 5 | 8.3%* | MATH: 3, REN: 2 | LCOE, annuity factor. |
| 5 | Quiz 3 | Weekly quiz | 19 | 5 | 8.3%* | REN: 3, PWR: 2 | PV power. |
| 6 | Problem 3 | Weekly problem | 19 | 5 | 8.3%* | PWR: 3, MATH: 2 | PV cell model, energy yield. |
| 7 | Quiz 4 | Weekly quiz | 20 | 5 | 8.3%* | REN: 3, PWR: 2 | Wind power. |
| 8 | Problem 4 | Weekly problem | 20 | 5 | 8.3%* | PWR: 3, MATH: 2 | Power coefficient, power curves, sizing. |
| 9 | Quiz 5 | Weekly quiz | 21 | 5 | 8.3%* | PWR: 3, REN: 2 | Wind generators. |
| 10 | Problem 5 | Weekly problem | 21 | 5 | 8.3%* | PWR: 3, THERMO: 2 | Synchronous machine, loss-to-heat balance. |
| 11 | Quiz 6 | Weekly quiz | 22 | 5 | 8.3%* | REN: 2, THERMO: 2, GRID: 1 | Small-hydro and combined heat and power. |
| 12 | Problem 6 | Weekly problem | 22 | 5 | 8.3%* | REN: 3, PWR: 1, GRID: 1 | Distributed generation. |

Total: PWR: 18, GRID: 7, REN: 20, THERMO: 4, MATH: 11. Sum 60.

## PBDat, Processamento de Big Data

Season 2, P4, weeks 23 to 29, CRAI, 6 ECTS. Grading formula of 2021/22.

https://fenix.tecnico.ulisboa.pt/disciplinas/PBDat/2021-2022/2-semestre

| Component | Weight | Minimum |
|---|---|---|
| Project, groups of 3 with individual grades, code at the end of week 6, video at the end of week 7, pitch in week 8 | 65% | 9.5 |
| Final exam | 35% | 9.5 |
| Final grade | 65% project + 35% exam | 9.5 |

Assumed split: the 65% of the project is split evenly across its three deliverables, 21.7% each (13 points). Its sub-weights are not published.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Pipeline Code | Project code | 28 | 13 | 21.7%* | DATA: 5, CODE: 4, ML: 2, OPT: 2 | Data pipeline on pose/embedding data: EDA, missing keypoints and outliers, GLRM imputation, PCA/sketching, clustering with outlier identification, alternating-minimization/SGD fitting. |
| 2 | Analysis Video | 15-min video | 29 | 13 | 21.7%* | DATA: 5, ML: 4, CODE: 3, MATH: 1 | Documented exploratory analysis, visualization of cluster structure and video segmentation, justification of modeling choices. |
| 3 | Defense | Pitch and discussion | ~29 | 13 | 21.7%* | ML: 5, DATA: 3, MATH: 3, CODE: 2 | Individual pitch and technical discussion defending methodology, algorithm choices and performance analysis. |
| 4 | Theorist | Final exam | ~29 | 21 | 35% | MATH: 7, ML: 5, OPT: 5, DATA: 4 | SVD and rank truncation, PPCA/factor analysis, GLRM losses, matrix sketching, k-means++/GMM/EM, stochastic gradient methods, imbalanced learning. |

Total: CODE: 9, DATA: 17, ML: 16, OPT: 7, MATH: 11. Sum 60.

## SAut, Sistemas Autonomos

Season 2, P4, weeks 23 to 29, CRAI, 6 ECTS. Grading formula of 2025/26.

https://fenix.tecnico.ulisboa.pt/disciplinas/SAut23610/2025-2026/2-semestre

| Component | Weight | Minimum |
|---|---|---|
| Project, groups of 4, 5 weekly progress presentations, 6-page report with code, final defense | 65% | 9.5 |
| Soft skills, assessed during the project presentations | 10% |  |
| Final written exam, 2 dates, the better grade counts | 25% |  |
| Final grade | 0.65 P + 0.10 SS + 0.25 E | 9.5 |

Assumed split: the 65% of the project is split evenly across its three assessments, 21.7% each (13 points). The 10% of soft skills (6 points) has no assessment of its own and goes to the defense badge, 19 points.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Progress Milestones | 5 weekly progress presentations, one grade | ~25 | 13 | 21.7%* | CODE: 4, SIM: 4, ML: 3, DATA: 2 | Weekly incremental demonstrations: Python micro-simulator from own motion/measurement models, synthetic-data validation, partial implementations. |
| 2 | Robot Project Report | Report and code, 6-page IEEE paper | ~26 | 13 | 21.7%* | CODE: 4, ML: 3, SIG: 3, DATA: 3 | ROS 2 implementation of EKF/MCL localization, occupancy-grid mapping, SLAM, or MDP/RL on real robots, rosbag workflow, multi-run evaluation against ground truth. |
| 3 | Project Defense | Final presentation and discussion, with soft skills | ~28 | 19 | 31.7%* | ML: 6, CODE: 5, MATH: 4, DATA: 4 | Defense of problem formalization, algorithm choice and experimental analysis, with the soft-skills component. |
| 4 | Theorist | Final exam | ~29 | 15 | 25% | MATH: 7, ML: 4, SIG: 2, CTR: 2 | Bayes filter, EKF/MCL derivations, occupancy-grid and SLAM formulations, MDP policies and RL, distributed sensor fusion, autonomy architectures. |

Total: CODE: 13, DATA: 9, ML: 16, CTR: 2, SIG: 5, SIM: 4, MATH: 11. Sum 60.

## COSE, Controlo e Optimizacao de Sistemas de Energia

Season 2, P4, weeks 23 to 29, Energy, 6 ECTS. Grading formula of 2025/26, assessment material from the tests of 2017/18.

https://fenix.tecnico.ulisboa.pt/disciplinas/COSE3610/2025-2026/2-semestre

| Component | Weight | Minimum |
|---|---|---|
| Continuous evaluation, 2 tests in class | 50% | 7 |
| Final exam | 50% | 7 |
| Final grade | 0.5 AC + 0.5 EX | 9.5 |

Assumed split: the 50% of the continuous evaluation is split evenly across its two tests, 25% each (15 points).

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | Frequency and Voltage Control | Test 1 | ~26 | 15 | 25%* | CTR: 6, PWR: 4, MATH: 3, GRID: 2 | Frequency regulation of turbo-generators, primary/secondary control, root locus, AVR voltage regulator, two-area interconnected state-space models, LQR interpretation. |
| 2 | Dispatch and Scheduling | Test 2 | ~28 | 15 | 25%* | OPT: 7, PWR: 3, GRID: 3, MATH: 2 | Economic dispatch, OPF and Lagrange multipliers, unit commitment via dynamic programming, hydro-thermal coordination, min-cost network flow hydro scheduling. |
| 3 | Theorist | Final exam | ~29 | 30 | 50% | CTR: 8, OPT: 8, GRID: 8, MATH: 6 | Full-syllabus assessment: interconnected-network control and stability, state estimation, dispatch and OPF optimality conditions, commitment and resource scheduling. |

Total: OPT: 15, CTR: 14, PWR: 7, GRID: 13, MATH: 11. Sum 60.

## MAPI, Modelacao e Automacao de Processos Industriais

Season 2, P4, weeks 23 to 29, Energy, 6 ECTS. Grading formula of 2024/25, assessment material from the exams of 2022/23 and 2023/24.

https://web.tecnico.ulisboa.pt/~ist13495/courses/mapi24d/mapi2425.html

| Component | Weight | Minimum |
|---|---|---|
| Quiz MAP30, on Moodle | 15% |  |
| Laboratory assignments, Lab 1 and Lab 2 | 30%, 15% each |  |
| Presentation, the third assignment | 10% |  |
| Final exam | 45% | 7.5 |
| Final grade | 0.15 quiz + 0.30 labs + 0.10 presentation + 0.45 exam | 9.5, oral above 17 |

The weekly follow-up sheets feed the lab grades and mint no badges of their own.

| # | Badge | Assessment | Week | Points | Share | Skill points | Content |
|---|---|---|---|---|---|---|---|
| 1 | PLC Fundamentals Lab | Lab 1 report | ~24 | 9 | 15% | CODE: 4, CTR: 2, DATA: 2, SIM: 1 | PLC digital I/O wiring, 7-segment ladder sequencing, scan-cycle period estimation, RC-circuit delay measurement, real and simulated PLC operation. |
| 2 | Alarm Automation Lab | Lab 2 report | ~26 | 9 | 15% | CODE: 3, CTR: 3, SIM: 2, DATA: 1 | Intrusion-detection alarm: mode-based finite state machine, Structured Text subroutines, matrix keyboard scanning, simulated-hardware development, timed buzzer/LED logic. |
| 3 | Automation Quiz | Quiz MAP30 | ~27 | 9 | 15% | CTR: 4, CODE: 3, MATH: 2 | PLC architecture and I/O, Ladder/ST/GRAFCET semantics, discrete event system modeling basics. |
| 4 | Process Modeler | Presentation | ~28 | 6 | 10% | CTR: 3, MATH: 2, SIM: 1 | Talk documenting an industrial process: I/O characterization, state machine or Petri net construction, property analysis. |
| 5 | Theorist | Final exam | ~29 | 27 | 45% | MATH: 10, CTR: 10, CODE: 5, DATA: 2 | ST code analysis with scan-cycle timing, Petri net reachability and invariants, supervisor synthesis, stochastic PNs, Markov chain steady-state probabilities. |

Total: CODE: 15, DATA: 5, CTR: 22, SIM: 4, MATH: 14. Sum 60.

## Supply

Skill points per type over the 20 courses.

| Type | CRAI | Energy | Total |
|---|---|---|---|
| CODE | 90 | 28 | 118 |
| DATA | 79 | 43 | 122 |
| ML | 64 | 5 | 69 |
| DL | 39 | 0 | 39 |
| OPT | 59 | 24 | 83 |
| CTR | 63 | 62 | 125 |
| SIG | 47 | 16 | 63 |
| PWR | 0 | 116 | 116 |
| GRID | 0 | 76 | 76 |
| REN | 2 | 37 | 39 |
| THERMO | 0 | 26 | 26 |
| SIM | 28 | 15 | 43 |
| MATH | 129 | 152 | 281 |
| Total | 600 | 600 | 1200 |

