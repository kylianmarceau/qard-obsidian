export type Project = {id:string; name:string; color:string};
export type Course = {id:string; projectId:string; name:string; description:string; color:string; icon:string};
export type Card = {id:string; courseId:string; front:string; back:string; mastered:boolean};
export type Workspace = {projects:Project[]; courses:Course[]; cards:Card[]};
export const starter:Workspace = {
 projects:[{id:'p1',name:'My learning',color:'blue'},{id:'p2',name:'Personal growth',color:'orange'}],
 courses:[
 {id:'c1',projectId:'p1',name:'Biology essentials',description:'A closer look at the living world.',color:'blue',icon:'biology'},
 {id:'c2',projectId:'p1',name:'Everyday French',description:'Little conversations, new possibilities.',color:'orange',icon:'language'},
 {id:'c3',projectId:'p2',name:'Design principles',description:'The foundations of thoughtful design.',color:'purple',icon:'design'}],
 cards:[
 {id:'b1',courseId:'c1',front:'What is the powerhouse of the cell?',back:'The mitochondrion. It produces most of the energy a cell needs through cellular respiration.',mastered:false},
 {id:'b2',courseId:'c1',front:'What is photosynthesis?',back:'The process by which plants use sunlight to turn carbon dioxide and water into glucose and oxygen.',mastered:false},
 {id:'b3',courseId:'c1',front:'What does DNA stand for?',back:'Deoxyribonucleic acid — the molecule that carries genetic instructions in living organisms.',mastered:false},
 {id:'b4',courseId:'c1',front:'What is the role of red blood cells?',back:'They transport oxygen from the lungs to tissues, using the protein haemoglobin.',mastered:false},
 {id:'f1',courseId:'c2',front:'How do you say “Nice to meet you” in French?',back:'Enchanté (masculine) or enchantée (feminine).',mastered:false},
 {id:'f2',courseId:'c2',front:'What does “à bientôt” mean?',back:'See you soon.',mastered:false},
 {id:'f3',courseId:'c2',front:'How do you ask “How are you?” informally?',back:'Comment ça va ? — or simply Ça va ?',mastered:false},
 {id:'d1',courseId:'c3',front:'What is visual hierarchy?',back:'The arrangement of elements to guide attention in order of importance, using size, contrast, spacing, and position.',mastered:false},
 {id:'d2',courseId:'c3',front:'Why does white space matter?',back:'It gives content room to breathe, improves readability, and helps people focus on what matters.',mastered:false},
 {id:'d3',courseId:'c3',front:'What is the principle of proximity?',back:'Elements placed close together are perceived as related.',mastered:false}]
};
