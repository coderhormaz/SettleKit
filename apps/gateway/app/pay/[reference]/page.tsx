import Collection from '../../collection.tsx';
export default async function Page({params}:{params:Promise<{reference:string}>}){const {reference}=await params;return <Collection kind="link" reference={reference}/>;}
